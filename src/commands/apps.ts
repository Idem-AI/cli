/** The applications of the team, and linking this folder to one. */
import { api, Application } from '../api.js';
import { readLink, removeLink } from '../project.js';
import { confirmOrStop, linkFolder, listApps, openBrowser, requireSignedIn, resolveApp, table } from '../shared.js';
import { webUrl } from '../config.js';
import { appUrl, color, fail, printJson, prompts } from '../ui.js';

function dot(status?: string | null): string {
  const s = (status ?? '').toLowerCase();
  if (s.startsWith('running')) return color.green('●');
  if (s.startsWith('exited') || s.includes('unhealthy') || s.includes('degraded')) return color.red('●');
  return color.dim('○');
}

export async function apps(): Promise<void> {
  requireSignedIn();
  const list = await listApps();
  if (printJson(list.map((a) => ({ uuid: a.uuid, name: a.name, workspace: a.workspace_name, status: a.status, url: appUrl(a) })))) return;
  if (list.length === 0) {
    prompts.log.info(`No application yet. Run ${color.cyan('idem deploy')} in a project folder.`);
    return;
  }
  const linked = readLink()?.applicationUuid;
  const width = Math.min(Math.max(...list.map((a) => a.name.length)), 32);
  const lines = list.map((a) => {
    const url = appUrl(a);
    return `${dot(a.status)} ${a.name.padEnd(width)}  ${color.dim((a.workspace_name ?? '').padEnd(18))} ${url ? color.cyan(url) : color.dim('—')}${a.uuid === linked ? color.yellow('  ← this folder') : ''}`;
  });
  process.stdout.write(lines.join('\n') + '\n');
}

export async function link(opts: { app?: string }): Promise<void> {
  requireSignedIn();
  let app: Application;
  if (opts.app) {
    app = await resolveApp(opts.app);
  } else {
    // Not resolveApp: it would answer with the application already linked.
    if (!process.stdin.isTTY) fail('Which application?', 'Pass `--app <name>`.');
    const list = await listApps();
    if (list.length === 0) fail('You have no application yet.', 'Run `idem deploy` here instead: it creates one.');
    const uuid = await prompts.select({
      message: 'Link this folder to',
      options: list.map((a) => ({ value: a.uuid, label: a.name, hint: a.workspace_name ?? undefined })),
    });
    if (prompts.isCancel(uuid)) return void prompts.cancel('Not linked.');
    app = list.find((a) => a.uuid === uuid)!;
  }
  linkFolder(app);
  if (!printJson({ linked: app.uuid, name: app.name })) prompts.log.success(`This folder now deploys to ${color.bold(app.name)}.`);
}

export async function unlink(): Promise<void> {
  const was = readLink();
  if (!removeLink()) {
    prompts.log.info('This folder was not linked.');
    return;
  }
  prompts.log.success(`Unlinked from ${color.bold(was?.applicationName ?? 'the application')}. The application itself is untouched.`);
}

interface DeploymentRow {
  deployment_uuid: string;
  status: string;
  commit?: string | null;
  created_at?: string;
}

export async function status(opts: { app?: string }): Promise<void> {
  const app = await resolveApp(opts.app);
  const [fresh, deployments, containers] = await Promise.all([
    api.get<Application>(`/applications/${app.uuid}`),
    api.get<DeploymentRow[]>(`/applications/${app.uuid}/deployments`).catch(() => [] as DeploymentRow[]),
    api.get<{ status: string }>(`/applications/${app.uuid}/status`).then((r) => r.status ?? '').catch(() => ''),
  ]);
  const last = deployments[0];
  if (printJson({ uuid: fresh.uuid, name: fresh.name, status: fresh.status, url: appUrl(fresh), lastDeployment: last ?? null })) return;
  const rows = [
    `${color.dim('Application')}  ${color.bold(fresh.name)}  ${dot(fresh.status)} ${fresh.status ?? 'unknown'}`,
    `${color.dim('Address    ')}  ${appUrl(fresh) ? color.cyan(appUrl(fresh)!) : '—'}`,
    `${color.dim('Workspace  ')}  ${fresh.workspace_name ?? '—'}`,
    last
      ? `${color.dim('Deployment ')}  ${last.status}  ${color.dim(`${last.deployment_uuid.slice(0, 8)}${last.created_at ? ` · ${new Date(last.created_at).toLocaleString()}` : ''}`)}`
      : `${color.dim('Deployment ')}  none yet`,
  ];
  if (containers.trim()) rows.push(`${color.dim('Containers ')}  ${containers.trim().split('\n').join('\n             ')}`);
  prompts.note(rows.join('\n'), 'Status');
}

export async function open(opts: { app?: string; dashboard?: boolean }): Promise<void> {
  const app = await resolveApp(opts.app);
  const url = opts.dashboard ? `${webUrl()}/applications/${app.uuid}` : appUrl(app);
  if (!url) fail(`${app.name} has no address yet.`, `Deploy it with ${color.cyan('idem deploy')}, or open its page: idem open --dashboard`);
  if (!openBrowser(url)) process.stdout.write(url + '\n');
  else prompts.log.info(`Opened ${color.cyan(url)}`);
}

export async function restart(opts: { app?: string; yes?: boolean }): Promise<void> {
  const app = await resolveApp(opts.app);
  if (!opts.yes && process.stdin.isTTY) {
    const sure = await prompts.confirm({ message: `Restart ${app.name}? It is briefly unavailable.`, initialValue: true });
    if (prompts.isCancel(sure) || !sure) return void prompts.cancel('Not restarted.');
  }
  const spin = prompts.spinner();
  spin.start(`Restarting ${app.name}`);
  await api.post(`/applications/${app.uuid}/restart`);
  spin.stop(`${app.name} restarted.`);
}

export async function dashboard(): Promise<void> {
  const url = webUrl();
  if (!openBrowser(url)) process.stdout.write(url + '\n');
}

export async function startStop(action: 'start' | 'stop', opts: { app?: string; yes?: boolean }): Promise<void> {
  const app = await resolveApp(opts.app);
  if (action === 'stop') await confirmOrStop(`Stop ${app.name}? It stops answering until started again.`, opts.yes);
  const spin = prompts.spinner();
  spin.start(`${action === 'start' ? 'Starting' : 'Stopping'} ${app.name}`);
  await api.post(`/applications/${app.uuid}/${action}`);
  spin.stop(`${app.name} ${action === 'start' ? 'started' : 'stopped'}.`);
}

/** Deletes the application, its containers, volumes and images on its server. */
export async function destroy(opts: { app?: string; yes?: boolean }): Promise<void> {
  const app = await resolveApp(opts.app);
  if (!opts.yes) {
    if (!process.stdin.isTTY) fail(`Deleting ${app.name} needs --yes.`);
    const typed = await prompts.text({ message: `Delete ${app.name}, its data and its address? Type its name to confirm` });
    if (prompts.isCancel(typed) || typed !== app.name) return void prompts.cancel('Nothing deleted.');
  }
  const r = await api.delete<{ serverCleanup?: string }>(`/applications/${app.uuid}`);
  if (readLink()?.applicationUuid === app.uuid) removeLink();
  if (printJson({ removed: app.uuid, serverCleanup: r?.serverCleanup })) return;
  prompts.log.success(`${app.name} deleted.${r?.serverCleanup === 'failed' ? color.yellow(' Its server could not be cleaned: it was unreachable.') : ''}`);
}

export async function deployments(opts: { app?: string }): Promise<void> {
  const app = await resolveApp(opts.app);
  const list = await api.get<DeploymentRow[]>(`/applications/${app.uuid}/deployments`);
  if (printJson(list)) return;
  if (list.length === 0) return void prompts.log.info(`${app.name} was never deployed.`);
  const mark = (s: string) => (s === 'finished' ? color.green('✓') : s === 'failed' ? color.red('✗') : color.yellow('…'));
  process.stdout.write(
    table(list.slice(0, 20).map((d) => [mark(d.status), d.deployment_uuid.slice(0, 8), d.status, d.commit && d.commit !== 'HEAD' ? d.commit.slice(0, 7) : '', color.dim(d.created_at ? new Date(d.created_at).toLocaleString() : '')])) + '\n'
  );
}

// ── Domains ───────────────────────────────────────────────────────────────────

interface DnsGuide {
  serverIp: string;
  domains: {
    host: string;
    status: string;
    record: { type: string; name: string; value: string; zone: string } | null;
    https: { status: string };
  }[];
}

function domainsOf(app: Application): string[] {
  return (app.fqdn ?? '').split(',').map((d) => d.trim()).filter(Boolean);
}

const bare = (d: string) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

/** Its addresses, with where their DNS and HTTPS stand. */
export async function domainsList(opts: { app?: string }): Promise<void> {
  const app = await resolveApp(opts.app);
  const guide = await api.get<DnsGuide>(`/applications/${app.uuid}/domains/dns`).catch(() => null);
  const domains = domainsOf(app);
  if (printJson(guide ?? domains)) return;
  if (domains.length === 0) return void prompts.log.info(`${app.name} has no address yet.`);
  const byHost = new Map((guide?.domains ?? []).map((d) => [d.host, d]));
  process.stdout.write(
    table(
      domains.map((d, i) => {
        const check = byHost.get(bare(d));
        const ok = check?.status === 'ok' || check?.status === 'automatic';
        const state = check ? `DNS ${check.status} · HTTPS ${check.https.status}` : '';
        return [i === 0 ? color.green('●') : color.dim('○'), d, ok ? color.green(state) : color.yellow(state)];
      })
    ) + '\n'
  );
}

export async function domainsAdd(domain: string, opts: { app?: string }): Promise<void> {
  const app = await resolveApp(opts.app);
  const host = bare(domain);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) fail(`"${domain}" is not a domain name.`);
  const current = domainsOf(app);
  if (current.some((d) => bare(d) === host)) return void prompts.log.info(`${host} is already one of its addresses.`);
  // Yours first: it becomes the main address.
  const updated = await api.patch<Application>(`/applications/${app.uuid}`, { fqdn: [`https://${host}`, ...current].join(',') });
  if (printJson(updated)) return;
  prompts.log.success(`${host} added to ${app.name}.`);
  const guide = await api.get<DnsGuide>(`/applications/${app.uuid}/domains/dns?domains=${encodeURIComponent(host)}`).catch(() => null);
  const record = guide?.domains.find((d) => d.host === host)?.record;
  if (record) prompts.note(`${record.type}   ${record.name}   →   ${record.value}\n${color.dim(`in the DNS zone of ${record.zone}`)}`, 'At your domain registrar, create');
  prompts.log.info(`HTTPS is issued once the DNS points here. Check: ${color.cyan('idem domains')}`);
}

export async function domainsRemove(domain: string, opts: { app?: string }): Promise<void> {
  const app = await resolveApp(opts.app);
  const host = bare(domain);
  const kept = domainsOf(app).filter((d) => bare(d) !== host);
  if (kept.length === domainsOf(app).length) fail(`${host} is not an address of ${app.name}.`);
  await api.patch<Application>(`/applications/${app.uuid}`, { fqdn: kept.join(',') });
  if (!printJson({ removed: host })) prompts.log.success(`${host} removed from ${app.name}.`);
}
