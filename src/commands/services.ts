/**
 * Services: Docker Compose stacks — a one-click template from the catalogue
 * (n8n, Plausible, Metabase…) or your own docker-compose.yml.
 */
import { api } from '../api.js';
import { confirmOrStop, pick, requireSignedIn, table } from '../shared.js';
import { color, fail, printJson, prompts } from '../ui.js';

interface Service {
  uuid: string;
  name: string;
  service_type?: string | null;
  status?: string | null;
}

interface Template {
  name: string;
  slogan: string;
  category: string;
  tags: string[];
}

const listServices = () => api.get<Service[]>('/services');

async function serviceOf(wanted?: string): Promise<Service> {
  requireSignedIn();
  return pick(await listServices(), wanted, 'service', (s) => s.service_type ?? undefined);
}

export async function servicesList(): Promise<void> {
  requireSignedIn();
  const list = await listServices();
  if (printJson(list)) return;
  if (list.length === 0) return void prompts.log.info(`No service yet. From the catalogue: ${color.cyan('idem templates')}, then ${color.cyan('idem deploy --template <name>')}.`);
  process.stdout.write(table([[color.dim('NAME'), color.dim('FROM'), color.dim('ID')], ...list.map((s) => [s.name, s.service_type ?? 'docker-compose.yml', color.dim(s.uuid.slice(0, 8))])]) + '\n');
}

export async function servicesAction(action: 'start' | 'stop' | 'restart', wanted?: string): Promise<void> {
  const svc = await serviceOf(wanted);
  const spin = prompts.spinner();
  spin.start(`${action === 'start' ? 'Starting' : action === 'stop' ? 'Stopping' : 'Restarting'} ${svc.name}`);
  const r = await api.post<{ success?: boolean; output?: string }>(`/services/${svc.uuid}/${action}`);
  if (r.success === false) {
    spin.stop(`${svc.name}: ${action} failed.`, 1);
    fail(r.output?.split('\n').slice(-8).join('\n') || `${action} failed.`);
  }
  spin.stop(`${svc.name}: done.`);
}

export async function servicesRemove(wanted: string | undefined, opts: { yes?: boolean }): Promise<void> {
  const svc = await serviceOf(wanted);
  await confirmOrStop(`Delete ${svc.name}, its containers and its volumes?`, opts.yes);
  await api.delete(`/services/${svc.uuid}`);
  if (!printJson({ removed: svc.uuid })) prompts.log.success(`${svc.name} deleted.`);
}

export async function templatesList(search: string | undefined): Promise<void> {
  requireSignedIn();
  const all = await api.get<Template[]>('/services/templates');
  const q = search?.toLowerCase();
  const list = q ? all.filter((t) => `${t.name} ${t.slogan} ${t.category} ${t.tags.join(' ')}`.toLowerCase().includes(q)) : all;
  if (printJson(list.map((t) => ({ name: t.name, category: t.category, slogan: t.slogan })))) return;
  if (list.length === 0) return void prompts.log.info(`No template matches "${search}".`);
  process.stdout.write(table(list.map((t) => [color.bold(t.name), color.dim(t.category), t.slogan.slice(0, 70)])) + '\n');
  prompts.log.info(`${list.length} templates. Deploy one: ${color.cyan('idem deploy --template <name>')}`);
}
