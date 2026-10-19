/** The applications of the team, and linking this folder to one. */
import { api, Application } from '../api.js';
import { readLink, removeLink } from '../project.js';
import { linkFolder, listApps, openBrowser, requireSignedIn, resolveApp } from '../shared.js';
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
