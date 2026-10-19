/**
 * Your own servers: add one (SSH key generated or yours), check it, install
 * Docker and the proxy on it, see what runs there. IDEM's managed servers are
 * not listed: a workspace on IDEM's infrastructure is placed on one for you.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { api } from '../api.js';
import { confirmOrStop, pick, requireSignedIn, table } from '../shared.js';
import { color, fail, interactive, printJson, prompts, unlessCancelled } from '../ui.js';
import { t } from '../i18n.js';

export interface Server {
  id: number;
  uuid: string;
  name: string;
  ip: string;
  port?: number;
  user?: string;
  description?: string | null;
}

interface Key {
  id: number;
  uuid: string;
  name: string;
  public_key?: string;
}

interface Readiness {
  ready: boolean;
  checks: { id: string; label: string; status: string; detail?: string; remedy?: string }[];
}

export const listServers = () => api.get<Server[]>('/servers');

export async function serverOf(wanted?: string): Promise<Server> {
  requireSignedIn();
  return pick(await listServers(), wanted, 'server', (s) => s.ip);
}

export async function serversList(): Promise<void> {
  requireSignedIn();
  const servers = await listServers();
  if (printJson(servers.map((s) => ({ uuid: s.uuid, name: s.name, ip: s.ip })))) return;
  if (servers.length === 0) return void prompts.log.info(t("No server of your own. Add one: {command} — or deploy on IDEM's infrastructure, nothing to add.", { command: color.cyan('idem servers add') }));
  process.stdout.write(table([[color.dim(t('NAME')), color.dim(t('ADDRESS')), color.dim(t('ID'))], ...servers.map((s) => [s.name, `${s.user ?? 'root'}@${s.ip}:${s.port ?? 22}`, color.dim(s.uuid.slice(0, 8))])]) + '\n');
}

function printReadiness(r: Readiness): void {
  for (const c of r.checks) {
    const mark = c.status === 'ok' ? color.green('✓') : c.status === 'warning' ? color.yellow('⚠') : c.status === 'skipped' ? color.dim('–') : color.red('✗');
    process.stdout.write(`${mark} ${c.label}${c.detail ? color.dim(` — ${c.detail}`) : ''}\n`);
    if (c.remedy && c.status !== 'ok') process.stdout.write(`  ${color.dim(c.remedy)}\n`);
  }
}

/** Add a server: name, address, SSH user, and a key — a new one to install, or one of yours. */
export async function serversAdd(opts: { name?: string; ip?: string; port?: string; user?: string; key?: string; setup?: boolean }): Promise<void> {
  requireSignedIn();
  const ask = interactive();
  const ip = opts.ip ?? (ask ? unlessCancelled(await prompts.text({ message: t('Server address (IP or host name)'), validate: (v) => (v.trim() ? undefined : t('Required.')) })) : undefined);
  if (!ip) fail(t('Give the address: --ip <address>.'));
  const name = opts.name ?? (ask ? unlessCancelled(await prompts.text({ message: t('Name'), initialValue: ip.replace(/[^a-z0-9-]+/gi, '-') })) : ip.replace(/[^a-z0-9-]+/gi, '-'));
  const user = opts.user ?? 'root';
  const port = Number(opts.port ?? 22);

  // The key: a file of yours, else a new pair whose public half goes on the server.
  let keyId: number;
  let installHint: string | null = null;
  let keyPath = opts.key;
  if (!keyPath && ask) {
    const choice = unlessCancelled(
      await prompts.select({
        message: t('SSH key iDeploy uses to reach it'),
        options: [
          { value: 'generate', label: t('Generate a new key'), hint: t('you add its public half to the server') },
          ...['id_ed25519', 'id_rsa'].filter((f) => existsSync(join(homedir(), '.ssh', f))).map((f) => ({ value: join(homedir(), '.ssh', f), label: t('Use {file}', { file: `~/.ssh/${f}` }) })),
          { value: 'path', label: t('Another private key file') },
        ],
      })
    );
    keyPath = choice === 'generate' ? undefined : choice === 'path' ? unlessCancelled(await prompts.text({ message: t('Path to the private key') })) : String(choice);
  }
  if (keyPath) {
    let pem: string;
    try {
      pem = readFileSync(keyPath.replace(/^~/, homedir()), 'utf8');
    } catch {
      fail(t('Cannot read {file}.', { file: keyPath }));
    }
    if (/ENCRYPTED/.test(pem)) fail(t('This key has a passphrase: iDeploy needs a key without one.'), t('Generate one instead (leave --key out).'));
    const key = await api.post<Key>('/security/keys', { name: `${name} (${keyPath.split('/').pop()})`, private_key: pem });
    keyId = key.id;
  } else {
    const key = await api.post<Key>('/security/keys/generate', { name: `${name} key` });
    keyId = key.id;
    installHint = key.public_key ?? null;
  }

  const server = await api.post<Server>('/servers', { name, ip, port, user, private_key_id: keyId });
  if (printJson({ uuid: server.uuid, name: server.name, publicKey: installHint })) return;
  prompts.log.success(t('Server {name} added.', { name: color.bold(server.name) }));
  if (installHint) {
    prompts.note(
      `${color.dim(t('On {ip}, as {user}, run:', { ip, user }))}\n\nmkdir -p ~/.ssh && echo '${installHint.trim()}' >> ~/.ssh/authorized_keys`,
      t('Install the public key')
    );
    if (ask) unlessCancelled(await prompts.confirm({ message: t('Done? (iDeploy checks the server next)'), initialValue: true }));
  }
  await serversCheck(server.uuid, { setup: opts.setup ?? true });
}

/** Can iDeploy deploy there? If not, offers to install what is missing (Docker, the proxy). */
export async function serversCheck(wanted: string | undefined, opts: { setup?: boolean } = {}): Promise<void> {
  const server = await serverOf(wanted);
  const spin = prompts.spinner();
  spin.start(t('Checking {name}', { name: server.name }));
  const r = await api.post<Readiness>(`/servers/${server.uuid}/validate`);
  spin.stop(r.ready ? t('{name} is ready to deploy.', { name: server.name }) : t('{name} is not ready yet.', { name: server.name }), r.ready ? 0 : 1);
  if (printJson(r)) return;
  printReadiness(r);
  if (r.ready) return;
  const setup = opts.setup && (!interactive() || unlessCancelled(await prompts.confirm({ message: t('Install Docker and the proxy on it now? (a few minutes)'), initialValue: true })));
  if (setup) await serversSetup(server.uuid);
  else prompts.log.info(t('When it is reachable: {command}', { command: color.cyan(`idem servers setup ${server.name}`) }));
}

export async function serversSetup(wanted?: string): Promise<void> {
  const server = await serverOf(wanted);
  const spin = prompts.spinner();
  spin.start(t('Installing Docker and the proxy on {name} (a few minutes)', { name: server.name }));
  try {
    const r = await api.post<{ success: boolean; output?: string; readiness?: Readiness }>(`/servers/${server.uuid}/setup`);
    spin.stop(r.success ? t('{name} is set up.', { name: server.name }) : t('The setup of {name} failed.', { name: server.name }), r.success ? 0 : 1);
    if (!r.success) {
      if (r.output) process.stdout.write(color.dim(r.output.split('\n').slice(-25).join('\n')) + '\n');
      fail(t('Setup failed — the end of its output is above.'));
    }
  } catch (err) {
    spin.stop(t('No answer yet.'), 1);
    fail(`${(err as Error).message}`, t('A long install can outlast the request: check it with {command}.', { command: color.cyan(`idem servers check ${server.name}`) }));
  }
}

export async function serversRemove(wanted: string | undefined, opts: { yes?: boolean }): Promise<void> {
  const server = await serverOf(wanted);
  await confirmOrStop(t('Remove {name} from iDeploy? What runs on it keeps running.', { name: server.name }), opts.yes);
  await api.delete(`/servers/${server.uuid}`);
  if (!printJson({ removed: server.uuid })) prompts.log.success(t('{name} removed.', { name: server.name }));
}
