/**
 * Databases, caches and queues of a workspace: PostgreSQL, MySQL, MariaDB,
 * MongoDB, Redis, KeyDB, Dragonfly, ClickHouse, RabbitMQ. Created next to the
 * applications of the workspace, on its network; `idem deploy` links them.
 */
import { api } from '../api.js';
import { confirmOrStop, pick, requireSignedIn, table } from '../shared.js';
import { color, fail, interactive, printJson, prompts, unlessCancelled } from '../ui.js';
import { workspaceOf } from './workspaces.js';

export const ENGINES = ['postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'keydb', 'dragonfly', 'clickhouse', 'rabbitmq'] as const;

interface Database {
  uuid: string;
  name: string;
  type: string;
  status: string | null;
  is_public?: boolean;
  public_port?: number | null;
}

interface DatabaseDetail extends Database {
  credentials: Record<string, string>;
  internal_host: string;
  port: number;
  connection_url: string | null;
  public_connection_url: string | null;
}

const listDatabases = () => api.get<Database[]>('/databases');

async function databaseOf(wanted?: string): Promise<Database> {
  requireSignedIn();
  return pick(await listDatabases(), wanted, 'database', (d) => `${d.type}${d.status ? ` · ${d.status}` : ''}`);
}

function dot(status: string | null): string {
  return (status ?? '').startsWith('running') ? color.green('●') : (status ?? '').startsWith('exited') ? color.red('●') : color.dim('○');
}

export async function dbList(): Promise<void> {
  requireSignedIn();
  const list = await listDatabases();
  if (printJson(list.map((d) => ({ uuid: d.uuid, name: d.name, type: d.type, status: d.status })))) return;
  if (list.length === 0) return void prompts.log.info(`No database yet: ${color.cyan('idem db create')}.`);
  process.stdout.write(table([[' ', color.dim('NAME'), color.dim('ENGINE'), color.dim('STATUS'), color.dim('ID')], ...list.map((d) => [dot(d.status), d.name, d.type, d.status ?? '—', color.dim(d.uuid.slice(0, 8))])]) + '\n');
}

export async function dbCreate(engine: string | undefined, opts: { name?: string; workspace?: string; start?: boolean }): Promise<void> {
  requireSignedIn();
  let type = engine?.toLowerCase();
  if (type === 'postgres' || type === 'pg') type = 'postgresql';
  if (!type) {
    if (!interactive()) fail(`Which engine? ${ENGINES.join(', ')}`);
    type = String(unlessCancelled(await prompts.select({ message: 'Engine', options: ENGINES.map((e) => ({ value: e, label: e })) })));
  }
  if (!(ENGINES as readonly string[]).includes(type)) fail(`Unknown engine "${type}".`, `One of: ${ENGINES.join(', ')}`);
  const ws = await workspaceOf(opts.workspace);
  const name =
    opts.name ?? (interactive() ? String(unlessCancelled(await prompts.text({ message: 'Name', initialValue: `${ws.name}-${type}` }))) : `${ws.name}-${type}`);

  const created = await api.post<Database>(`/databases/${type}`, { name, workspace_uuid: ws.uuid });
  if (opts.start !== false) {
    const spin = interactive() ? prompts.spinner() : null;
    spin?.start(`Starting ${name}`);
    const r = await api.post<{ success?: boolean }>(`/databases/${type}/${created.uuid}/start`).catch((e: Error) => ({ success: false, error: e.message }));
    spin?.stop(r.success === false ? `${name} created, but did not start.` : `${name} is running.`, r.success === false ? 1 : 0);
  }
  if (printJson(created)) return;
  prompts.log.success(`${color.bold(name)} (${type}) in workspace ${ws.name}. Its credentials: ${color.cyan(`idem db show ${name}`)}`);
  prompts.log.info(`The applications of ${ws.name} get its address at their next ${color.cyan('idem deploy')} (example values only).`);
}

export async function dbShow(wanted: string | undefined, opts: { reveal?: boolean }): Promise<void> {
  const db = await databaseOf(wanted);
  const d = await api.get<DatabaseDetail>(`/databases/${db.type}/${db.uuid}`);
  const hide = (v: string | null) => (v && !opts.reveal ? v.replace(/:\/\/([^:@/]*):([^@]*)@/, '://$1:••••@') : v);
  if (printJson(opts.reveal ? d : { ...d, credentials: undefined, connection_url: hide(d.connection_url), public_connection_url: hide(d.public_connection_url) })) return;
  const creds = Object.entries(d.credentials ?? {}).map(([k, v]) => `${color.dim(k.padEnd(24))} ${opts.reveal || !/pass|secret|key/i.test(k) ? v : '••••'}`);
  prompts.note(
    [
      `${color.dim('Engine'.padEnd(24))} ${d.type}  ${dot(d.status)} ${d.status ?? ''}`,
      `${color.dim('Inside the workspace'.padEnd(24))} ${d.internal_host}:${d.port}`,
      `${color.dim('Connection URL'.padEnd(24))} ${hide(d.connection_url) ?? '—'}`,
      ...(d.public_connection_url ? [`${color.dim('From outside'.padEnd(24))} ${hide(d.public_connection_url)}`] : []),
      '',
      ...creds,
    ].join('\n'),
    d.name
  );
  if (!opts.reveal) prompts.log.info(color.dim('Secrets hidden — --reveal shows them.'));
}

export async function dbAction(action: 'start' | 'stop' | 'restart', wanted: string | undefined): Promise<void> {
  const db = await databaseOf(wanted);
  const spin = prompts.spinner();
  spin.start(`${action === 'start' ? 'Starting' : action === 'stop' ? 'Stopping' : 'Restarting'} ${db.name}`);
  const r = await api.post<{ success?: boolean; output?: string }>(`/databases/${db.type}/${db.uuid}/${action}`);
  if (r.success === false) {
    spin.stop(`${db.name}: ${action} failed.`, 1);
    fail(r.output?.split('\n').slice(-6).join('\n') || `${action} failed.`);
  }
  spin.stop(`${db.name}: done.`);
}

export async function dbBackup(wanted: string | undefined): Promise<void> {
  const db = await databaseOf(wanted);
  const spin = prompts.spinner();
  spin.start(`Backing up ${db.name}`);
  const r = await api.post<{ success: boolean; filename: string; output: string }>(`/databases/${db.type}/${db.uuid}/backup-now`);
  spin.stop(r.success ? `Backup made: ${r.filename}` : 'The backup failed.', r.success ? 0 : 1);
  if (!r.success) fail(r.output.split('\n').slice(-6).join('\n') || 'Backup failed.');
  printJson(r);
}

export async function dbRemove(wanted: string | undefined, opts: { yes?: boolean }): Promise<void> {
  const db = await databaseOf(wanted);
  await confirmOrStop(`Delete ${db.name} (${db.type}) and all its data? This cannot be undone.`, opts.yes);
  await api.delete(`/databases/${db.type}/${db.uuid}`);
  if (!printJson({ removed: db.uuid })) prompts.log.success(`${db.name} deleted.`);
}
