/**
 * What several commands need: the browser, the application a command is about,
 * a deployment followed to its end, a .env read.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { api, Application, Deployment } from './api.js';
import { readLink, writeLink } from './project.js';
import { token } from './config.js';
import { color, fail, interactive, prompts, unlessCancelled } from './ui.js';

/** Opens a page in the default browser; false when there is none (SSH, CI). */
export function openBrowser(url: string): boolean {
  if (!interactive()) return false;
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function requireSignedIn(): void {
  if (!token()) fail('You are not signed in.', 'Run `idem login` — or set IDEM_TOKEN in CI.');
}

export async function listApps(): Promise<Application[]> {
  return api.get<Application[]>('/applications');
}

/**
 * The application a command acts on: `--app <name|uuid>`, else the one this
 * folder is linked to, else one chosen from the list.
 */
export async function resolveApp(option?: string): Promise<Application> {
  requireSignedIn();
  if (option) {
    const apps = await listApps();
    const wanted = option.toLowerCase();
    const found = apps.filter((a) => a.uuid === option || a.name.toLowerCase() === wanted);
    if (found.length === 1) return found[0];
    if (found.length > 1) fail(`Several applications are named "${option}".`, 'Use its id: `idem apps` lists them.');
    fail(`No application "${option}".`, '`idem apps` lists them.');
  }
  const link = readLink();
  if (link) {
    try {
      return await api.get<Application>(`/applications/${link.applicationUuid}`);
    } catch {
      fail(`This folder is linked to "${link.applicationName}", which no longer exists.`, 'Run `idem unlink`, then `idem deploy`.');
    }
  }
  if (!interactive()) fail('No application given.', 'Pass `--app <name>`, or run it in a folder linked with `idem link`.');
  const apps = await listApps();
  if (apps.length === 0) fail('You have no application yet.', 'Run `idem deploy` in your project folder.');
  const uuid = unlessCancelled(
    await prompts.select({
      message: 'Which application?',
      options: apps.map((a) => ({ value: a.uuid, label: a.name, hint: a.workspace_name ?? undefined })),
    })
  );
  return apps.find((a) => a.uuid === uuid)!;
}

export function linkFolder(app: Application): void {
  writeLink({
    applicationUuid: app.uuid,
    applicationName: app.name,
    workspaceUuid: app.workspace_uuid ?? null,
    workspaceName: app.workspace_name ?? null,
  });
}

const FINAL = new Set(['finished', 'failed', 'cancelled-by-user']);

/** A log line, coloured by what it says. */
function paint(line: string): string {
  if (/^\s*(❌|✗|ERROR|Error:)/.test(line)) return color.red(line);
  if (/^\s*(⚠|WARN)/.test(line)) return color.yellow(line);
  if (/^\s*(✅|✓)/.test(line)) return color.green(line);
  if (/^\s*──►/.test(line)) return color.cyan(color.bold(line));
  if (/^\s*\$ /.test(line)) return color.dim(line);
  return line;
}

/** What is new in a log the API returns whole (its start may have been trimmed). */
export function newPart(previous: string, current: string): string {
  if (!previous) return current;
  if (current.startsWith(previous)) return current.slice(previous.length);
  const tail = previous.slice(-400);
  const at = current.lastIndexOf(tail);
  return at >= 0 ? current.slice(at + tail.length) : current;
}

/**
 * Follows a deployment to its end, printing its log as it is written.
 * Resolves with the final deployment.
 */
export async function followDeployment(deploymentUuid: string, opts: { quiet?: boolean } = {}): Promise<Deployment> {
  let printed = '';
  let partial = '';
  let failures = 0;
  const started = Date.now();
  for (;;) {
    let d: Deployment;
    try {
      d = await api.get<Deployment>(`/deploy/${deploymentUuid}`);
      failures = 0;
    } catch (err) {
      // A network hiccup during a long build is not the deployment failing.
      if (++failures >= 10) throw err;
      await sleep(3000);
      continue;
    }
    const logs = d.logs ?? '';
    const fresh = newPart(printed, logs);
    printed = logs;
    if (!opts.quiet && fresh) {
      const text = partial + fresh;
      const lines = text.split('\n');
      partial = FINAL.has(d.status) ? '' : (lines.pop() ?? '');
      for (const line of FINAL.has(d.status) ? lines.filter(Boolean) : lines) process.stdout.write(`${color.dim('│')}  ${paint(line)}\n`);
    }
    if (FINAL.has(d.status)) return d;
    // Hours, not minutes: a build can be long; Ctrl+C stops following, not the deployment.
    if (Date.now() - started > 3 * 3600 * 1000) return d;
    await sleep(2000);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** KEY=VALUE lines of a .env file: comments, `export`, quotes handled. */
export function parseEnv(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out.push({ key: m[1], value });
  }
  return out;
}

export function readEnvFile(path: string): { key: string; value: string }[] | null {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** A name iDeploy accepts, from a folder name. */
export function appNameFrom(folder: string): string {
  return (
    folder
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'my-app'
  );
}

export function elapsed(since: number): string {
  const s = Math.round((Date.now() - since) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
}
