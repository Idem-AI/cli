/**
 * Workspaces: where things run together. On IDEM's infrastructure (a managed
 * server is chosen for you, in a region when your plan allows), or on one of
 * your servers. Everything in a workspace shares one private network: the
 * databases are reached by name, and linked to the applications.
 */
import { api } from '../api.js';
import { confirmOrStop, pick, requireSignedIn, table } from '../shared.js';
import { color, fail, interactive, printJson, prompts, unlessCancelled } from '../ui.js';
import { listServers, Server } from './servers.js';
import { t } from '../i18n.js';

export interface Workspace {
  uuid: string;
  name: string;
  description?: string | null;
  deploymentType?: 'saas' | 'own';
  region?: string | null;
  assignedServerName?: string | null;
}

interface Options {
  regionSelectionAllowed: boolean;
  availableRegions: { code: string; name?: string }[] | string[];
}

interface Resource {
  kind: 'application' | 'database' | 'service';
  uuid: string;
  name: string;
  status: string | null;
  databaseType: string | null;
  /** How its neighbours reach it on the workspace's network. */
  internalHost: string;
}

export const listWorkspaces = () => api.get<Workspace[]>('/workspaces');

export async function workspaceOf(wanted?: string): Promise<Workspace> {
  requireSignedIn();
  return pick(await listWorkspaces(), wanted, 'workspace', where);
}

function where(w: Workspace): string {
  return w.deploymentType === 'own' ? t('your server {name}', { name: w.assignedServerName ?? '' }).trim() : `IDEM${w.region ? ` · ${w.region}` : ''}`;
}

export async function workspacesList(): Promise<void> {
  requireSignedIn();
  const list = await listWorkspaces();
  if (printJson(list)) return;
  if (list.length === 0) return void prompts.log.info(t('No workspace yet. {a} creates one, or {b}.', { a: color.cyan('idem deploy'), b: color.cyan('idem workspaces create') }));
  process.stdout.write(table([[color.dim(t('NAME')), color.dim(t('RUNS ON')), color.dim(t('ID'))], ...list.map((w) => [w.name, where(w), color.dim(w.uuid.slice(0, 8))])]) + '\n');
}

/**
 * Where a new workspace runs — asked on a terminal, from flags otherwise:
 * `--server <name>` (yours) or `--region <code>` (IDEM's).
 */
export async function placement(opts: { server?: string; region?: string }): Promise<{ deployment_type: 'saas' | 'own'; server_uuid?: string; region?: string }> {
  if (opts.server) {
    const server = await pick(await listServers(), opts.server, 'server', (s) => s.ip);
    return { deployment_type: 'own', server_uuid: server.uuid };
  }
  if (opts.region || !interactive()) return { deployment_type: 'saas', ...(opts.region ? { region: opts.region } : {}) };

  const servers: Server[] = await listServers().catch(() => []);
  const choice = unlessCancelled(
    await prompts.select({
      message: t('Where should it run?'),
      options: [
        { value: 'saas', label: t("IDEM's infrastructure"), hint: t('nothing to manage') },
        ...servers.map((s) => ({ value: s.uuid, label: t('Your server {name}', { name: s.name }), hint: s.ip })),
        ...(servers.length === 0 ? [{ value: 'add', label: t('One of your servers…'), hint: t('add it first: idem servers add') }] : []),
      ],
    })
  );
  if (choice === 'add') fail(t('Add your server first.'), t('{command}, then run this again.', { command: color.cyan('idem servers add') }));
  if (choice !== 'saas') return { deployment_type: 'own', server_uuid: String(choice) };

  const options = await api.get<Options>('/workspaces/options').catch(() => null);
  const regions = (options?.availableRegions ?? []).map((r) => (typeof r === 'string' ? { code: r } : r));
  if (!options?.regionSelectionAllowed || regions.length < 2) return { deployment_type: 'saas' };
  const region = unlessCancelled(
    await prompts.select({
      message: t('Region'),
      options: [{ value: '', label: t('Automatic'), hint: t('the nearest with room') }, ...regions.map((r) => ({ value: r.code, label: r.name ?? r.code }))],
    })
  );
  return { deployment_type: 'saas', ...(region ? { region: String(region) } : {}) };
}

export async function workspacesCreate(name: string | undefined, opts: { server?: string; region?: string; description?: string }): Promise<void> {
  requireSignedIn();
  const wsName = name ?? (interactive() ? unlessCancelled(await prompts.text({ message: t('Workspace name'), validate: (v) => (v.trim() ? undefined : t('Required.')) })) : undefined);
  if (!wsName) fail(t('Give a name: idem workspaces create <name>.'));
  const where_ = await placement(opts);
  const created = await api.post<Workspace>('/workspaces', { name: wsName, description: opts.description, ...where_ });
  if (!printJson(created)) prompts.log.success(t('Workspace {name} created ({where}).', { name: color.bold(created.name), where: where(created) }));
}

export async function workspacesShow(wanted?: string): Promise<void> {
  const ws = await workspaceOf(wanted);
  const resources = await api.get<Resource[]>(`/workspaces/${ws.uuid}/resources`).catch(() => [] as Resource[]);
  if (printJson({ ...ws, resources })) return;
  prompts.note(
    [
      `${color.dim(t('Runs on'))}  ${where(ws)}`,
      '',
      ...(resources.length
        ? resources.map((r) => `${r.name}  ${color.dim(`${r.databaseType ?? r.kind}${r.status ? ` · ${r.status}` : ''} · ${r.internalHost}`)}`)
        : [color.dim(t('Empty.'))]),
    ].join('\n'),
    ws.name
  );
}

export async function workspacesRemove(wanted: string | undefined, opts: { yes?: boolean }): Promise<void> {
  const ws = await workspaceOf(wanted);
  await confirmOrStop(t('Delete workspace {name}? It must be empty.', { name: ws.name }), opts.yes);
  await api.delete(`/workspaces/${ws.uuid}`);
  if (!printJson({ removed: ws.uuid })) prompts.log.success(t('{name} deleted.', { name: ws.name }));
}
