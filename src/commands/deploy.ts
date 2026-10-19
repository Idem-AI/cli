/**
 * `idem deploy` — the one command. Signs in if needed, then deploys:
 *
 *   idem deploy                      this folder (its code is sent)
 *   idem deploy --git <url>          a Git repository (a branch, a sub-folder)
 *   idem deploy --image <ref>        an image already in a registry
 *   idem deploy --compose <file>     a docker-compose.yml, as a service
 *   idem deploy --template <name>    a one-click service of the catalogue
 *
 * The first time, it creates the application in a workspace — on IDEM's
 * infrastructure (`--region`) or on one of your servers (`--server`) — and
 * remembers it in `.idem/project.json`. Then it follows the deployment and
 * ends with the address, or with why it failed.
 */
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { api, ApiError, Application } from '../api.js';
import { token } from '../config.js';
import { formatBytes, MAX_BYTES, MAX_FILES, packFolder, Pack } from '../pack.js';
import { readLink, removeLink, writeLink } from '../project.js';
import { appNameFrom, elapsed, followDeployment, listApps, readEnvFile, resolveApp } from '../shared.js';
import { appUrl, color, fail, interactive, isJson, printJson, prompts, unlessCancelled } from '../ui.js';
import { browserLogin } from './auth.js';
import { listWorkspaces, placement } from './workspaces.js';
import { t } from '../i18n.js';

export interface DeployOptions {
  app?: string;
  workspace?: string;
  name?: string;
  yes?: boolean;
  detach?: boolean;
  env?: boolean | string;
  upload?: boolean;
  // Sources
  git?: string;
  branch?: string;
  image?: string;
  tag?: string;
  registryUser?: string;
  compose?: string;
  template?: string;
  // Where a new workspace runs
  server?: string;
  region?: string;
  // Build settings of a new application
  baseDir?: string;
  install?: string;
  build?: string;
  start?: string;
  port?: string;
  publishDir?: string;
}

interface QuickDeployResult {
  kind: 'application' | 'service';
  deploymentUuid?: string;
  applicationUuid?: string;
  serviceUuid?: string;
  url?: string | null;
  workspace: { uuid: string; name: string };
  linkedVariables?: { key: string; resource: string }[];
}

type Source = 'folder' | 'git' | 'image' | 'compose' | 'template';

const NEW_WORKSPACE = '__new__';

function sourceOf(opts: DeployOptions): Source {
  const given = (['git', 'image', 'compose', 'template'] as const).filter((k) => opts[k]);
  if (given.length > 1) fail(t('Choose one source: {sources}.', { sources: `--${given.join(', --')}` }));
  return given[0] ?? 'folder';
}

function link(app: { uuid: string; name: string; workspace_uuid?: string | null; workspace_name?: string | null }): void {
  writeLink({ applicationUuid: app.uuid, applicationName: app.name, workspaceUuid: app.workspace_uuid, workspaceName: app.workspace_name });
}

export async function deploy(opts: DeployOptions): Promise<void> {
  const started = Date.now();
  const cwd = process.cwd();
  const ask = interactive() && !opts.yes && !isJson();
  const source = sourceOf(opts);
  if (!isJson()) prompts.intro(color.bgCyan(color.black(' idem deploy ')));

  // 1. Signed in — through the browser, right here, the first time.
  if (!token()) {
    if (!interactive()) fail(t('You are not signed in.'), t('In CI, set IDEM_TOKEN (Security › API tokens on iDeploy).'));
    await browserLogin();
  }

  // 2. An existing application: --app, or this folder's link (folder deployments only).
  let target: Application | null = null;
  if (opts.app) {
    target = await resolveApp(opts.app);
    if (source === 'folder') link(target);
  } else if (source === 'folder') {
    target = await linkedOrSameName(cwd, ask);
  }

  if (target) return redeploy(target, opts, started);
  if (source === 'compose' || source === 'template') return createService(source, opts, ask, started);
  return createApplication(source, opts, ask, started);
}

/** The folder's application — or one of the same name, offered when the folder was deployed from elsewhere. */
async function linkedOrSameName(cwd: string, ask: boolean): Promise<Application | null> {
  const saved = readLink();
  if (saved) {
    const app = await api.get<Application>(`/applications/${saved.applicationUuid}`).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    });
    if (app) return app;
    removeLink();
    prompts.log.warn(t('"{name}" no longer exists on iDeploy: a new application is created.', { name: saved.applicationName }));
    return null;
  }
  if (!ask) return null;
  const name = appNameFrom(basename(cwd));
  const same = (await listApps()).filter((a) => a.name.toLowerCase() === name);
  if (same.length === 0) return null;
  const choice = unlessCancelled(
    await prompts.select({
      message: t('An application "{name}" exists already. Deploy this folder to it?', { name }),
      options: [
        ...same.map((a) => ({ value: a.uuid, label: t('Yes — {name}', { name: a.name }), hint: a.workspace_name ?? undefined })),
        { value: '', label: t('No — create a new application') },
      ],
    })
  );
  const chosen = same.find((a) => a.uuid === choice) ?? null;
  if (chosen) link(chosen);
  return chosen;
}

/** The code of this folder, within the API's limits — or a clear stop. */
function readProject(cwd: string): Pack {
  const spin = isJson() ? null : prompts.spinner();
  spin?.start(t('Reading the project'));
  const pack = packFolder(cwd);
  if (pack.count === 0) {
    spin?.stop(t('Nothing to send.'), 1);
    fail(t('This folder has no file to deploy.'), t('Run `idem deploy` in your project folder, or deploy a source: --git, --image, --compose, --template.'));
  }
  if (pack.tooLarge) {
    spin?.stop(t('Too large to send.'), 1);
    const heavy = pack.heaviest.map((h) => `  ${h.dir}  ${formatBytes(h.bytes)}`).join('\n');
    fail(
      t('The project is {size} in {count} files: the CLI sends up to {max} and {maxFiles} files.', { size: formatBytes(pack.bytes), count: pack.count, max: formatBytes(MAX_BYTES), maxFiles: MAX_FILES }),
      t('The heaviest folders:\n{list}\nAdd what the build does not need to .idemignore (as .gitignore), or deploy from Git: idem deploy --git <url>.', { list: heavy })
    );
  }
  spin?.stop(t('Project read: {count} files, {size}', { count: pack.count, size: formatBytes(pack.bytes) }));
  return pack;
}

/** An existing application: its code is replaced (a folder), or it is rebuilt from its own source. */
async function redeploy(app: Application, opts: DeployOptions, started: number): Promise<void> {
  const fromGit = Boolean(app.git_repository) && app.build_pack !== 'dockerimage';
  const fromImage = app.build_pack === 'dockerimage';
  let deploymentUuid: string;

  if ((fromGit || fromImage) && !opts.upload) {
    // Its source is a repository or an image: sending this folder would replace it.
    const what = fromImage ? t('its image') + (opts.tag ? ` (tag ${opts.tag})` : '') : t('its repository') + (app.git_repository ? ` ${color.dim(app.git_repository)}` : '');
    if (!isJson()) prompts.log.info(`${t('{name} deploys from {what}.', { name: color.bold(app.name), what })} ${color.dim(t('(--upload sends this folder instead)'))}`);
    const queued = await api.post<{ deploymentUuid: string }>('/deploy', { uuid: app.uuid, ...(opts.tag ? { image_tag: opts.tag } : {}) });
    deploymentUuid = queued.deploymentUuid;
  } else {
    const pack = readProject(process.cwd());
    const spin = isJson() ? null : prompts.spinner();
    spin?.start(t('Sending the code to {name}', { name: color.bold(app.name) }));
    const sent = await api.put<{ deploymentUuid: string | null }>(`/applications/${app.uuid}/source`, { files: pack.files, deploy: true });
    if (!sent.deploymentUuid) {
      spin?.stop(t('Code sent, but no deployment was queued.'), 1);
      fail(t('iDeploy did not queue a deployment.'));
    }
    spin?.stop(t('Code sent to {name}', { name: color.bold(app.name) }));
    deploymentUuid = sent.deploymentUuid;
  }
  await follow(app.uuid, app.name, deploymentUuid, appUrl(app), opts, started);
}

/** The workspace of a new resource: --workspace, a choice, or a new one — on IDEM or on your server. */
async function workspaceFor(
  name: string,
  opts: DeployOptions,
  ask: boolean
): Promise<{ workspace_uuid?: string; workspace_name?: string; deployment_type?: 'saas' | 'own'; server_uuid?: string; region?: string }> {
  if (opts.workspace) {
    const found = (await listWorkspaces()).find((w) => w.uuid === opts.workspace || w.name.toLowerCase() === opts.workspace!.toLowerCase());
    if (found) return { workspace_uuid: found.uuid };
    return { workspace_name: opts.workspace, ...(await placement(opts)) };
  }
  if (ask) {
    const workspaces = await listWorkspaces();
    if (workspaces.length > 0) {
      const choice = unlessCancelled(
        await prompts.select({
          message: t('Workspace (its databases are linked automatically)'),
          options: [
            { value: NEW_WORKSPACE, label: t('New workspace "{name}"', { name }) },
            ...workspaces.map((w) => ({
              value: w.uuid,
              label: w.name,
              hint: w.deploymentType === 'own' ? t('your server {name}', { name: w.assignedServerName ?? '' }).trim() : 'IDEM',
            })),
          ],
        })
      );
      if (choice !== NEW_WORKSPACE) return { workspace_uuid: String(choice) };
    }
  }
  return { workspace_name: name, ...(await placement(opts)) };
}

/** The variables a new application starts with: `--env <file>`, or the folder's .env when agreed. */
async function variablesFor(opts: DeployOptions, ask: boolean): Promise<{ key: string; value: string }[]> {
  const file = typeof opts.env === 'string' ? resolve(opts.env) : join(process.cwd(), '.env');
  const local = readEnvFile(file);
  if (typeof opts.env === 'string' && !local) fail(t('Cannot read {file}.', { file: String(opts.env) }));
  if (!local || local.length === 0) return [];
  if (opts.env) return local;
  if (!ask) return [];
  const send = unlessCancelled(
    await prompts.confirm({
      message: t('Send the {count} variables of .env? ({keys}) — iDeploy replaces local addresses by its own databases', {
        count: local.length,
        keys: local.slice(0, 4).map((v) => v.key).join(', ') + (local.length > 4 ? '…' : ''),
      }),
      initialValue: true,
    })
  );
  return send ? local : [];
}

async function nameFor(opts: DeployOptions, ask: boolean, fallback: string): Promise<string> {
  let name = appNameFrom(opts.name ?? fallback);
  if (ask && !opts.name) {
    name = appNameFrom(
      unlessCancelled(
        await prompts.text({ message: t('Name'), initialValue: name, validate: (v) => (appNameFrom(v) ? undefined : t('Letters, digits and dashes.')) })
      )
    );
  }
  return name;
}

async function createApplication(source: Source, opts: DeployOptions, ask: boolean, started: number): Promise<void> {
  const cwd = process.cwd();
  const fallback =
    source === 'git'
      ? basename(opts.git!.replace(/\.git$/, '').replace(/\/+$/, ''))
      : source === 'image'
        ? basename(opts.image!.split(':')[0])
        : basename(cwd);
  const pack = source === 'folder' ? readProject(cwd) : null;
  const name = await nameFor(opts, ask, fallback);
  const workspace = await workspaceFor(name, opts, ask);
  const environment_variables = await variablesFor(opts, ask);

  const [image, imageTag] = opts.image ? splitImage(opts.image) : [undefined, undefined];
  const registry_password = process.env.IDEM_REGISTRY_PASSWORD;
  if (opts.registryUser && !registry_password) fail(t('Give the registry password in IDEM_REGISTRY_PASSWORD (never on the command line).'));

  const spin = isJson() ? null : prompts.spinner();
  spin?.start(t('Creating {name}', { name: color.bold(name) }));
  const created = await api.post<QuickDeployResult>('/quick-deploy', {
    name,
    ...workspace,
    environment_variables,
    ...(pack ? { files: pack.files } : {}),
    ...(source === 'git' ? { git_repository: opts.git, git_branch: opts.branch } : {}),
    ...(source === 'image'
      ? { build_pack: 'dockerimage', docker_image: image, docker_image_tag: opts.tag ?? imageTag, registry_username: opts.registryUser, registry_password }
      : {}),
    base_directory: opts.baseDir,
    install_command: opts.install,
    build_command: opts.build,
    start_command: opts.start,
    ports_exposes: opts.port,
    publish_directory: opts.publishDir,
  });
  if (!created.applicationUuid || !created.deploymentUuid) {
    spin?.stop(t('Not created.'), 1);
    fail(t('iDeploy did not create the application.'));
  }
  spin?.stop(t('Created {name} in workspace {workspace}', { name: color.bold(name), workspace: color.bold(created.workspace.name) }));
  if (source === 'folder') {
    writeLink({ applicationUuid: created.applicationUuid, applicationName: name, workspaceUuid: created.workspace.uuid, workspaceName: created.workspace.name });
  }
  await follow(created.applicationUuid, name, created.deploymentUuid, created.url ?? null, opts, started, created.linkedVariables);
}

/** A compose file or a catalogue template: a service, started at once. */
async function createService(source: 'compose' | 'template', opts: DeployOptions, ask: boolean, started: number): Promise<void> {
  const fallback = source === 'template' ? opts.template! : basename(process.cwd());
  const name = await nameFor(opts, ask, fallback);
  let workspace = await workspaceFor(name, opts, ask);
  const environment_variables = await variablesFor(opts, ask);
  const spin = isJson() ? null : prompts.spinner();

  if (source === 'template') {
    spin?.start(t('Deploying the template {name}', { name: color.bold(opts.template!) }));
    const created = await api.post<QuickDeployResult>('/quick-deploy', { name, template: opts.template, ...workspace, environment_variables });
    spin?.stop(t('{name} is starting in workspace {workspace}', { name: color.bold(name), workspace: color.bold(created.workspace.name) }));
    if (!printJson(created)) prompts.outro(`${t('Its address and passwords: {a} · page on iDeploy: {b}', { a: color.cyan('idem services'), b: color.cyan('idem dashboard') })}  ${color.dim(`(${elapsed(started)})`)}`);
    return;
  }

  let compose: string;
  try {
    compose = readFileSync(resolve(opts.compose!), 'utf8');
  } catch {
    fail(t('Cannot read {file}.', { file: opts.compose! }));
  }
  // A service goes into an existing workspace: a new one is created first.
  if (!workspace.workspace_uuid) {
    const { workspace_name, ...where } = workspace;
    const created = await api.post<{ uuid: string; name: string }>('/workspaces', { name: workspace_name, ...where });
    workspace = { workspace_uuid: created.uuid };
  }
  spin?.start(t('Creating the service {name}', { name: color.bold(name) }));
  const service = await api.post<{ uuid: string; name: string }>('/services', {
    name,
    workspace_uuid: workspace.workspace_uuid,
    docker_compose_raw: compose,
    environment_variables,
  });
  spin?.message(t('Starting {name} (pulling its images)', { name: color.bold(name) }));
  const result = await api.post<{ success?: boolean; output?: string }>(`/services/${service.uuid}/start`);
  if (result.success === false) {
    spin?.stop(t('{name} did not start.', { name }), 1);
    if (result.output && !isJson()) process.stdout.write(color.dim(result.output.split('\n').slice(-20).join('\n')) + '\n');
    fail(t('The service failed to start — the end of its output is above.'), t('Fix the compose file, then: idem services restart {name}', { name }));
  }
  spin?.stop(t('{name} is running.', { name: color.bold(name) }));
  if (!printJson({ serviceUuid: service.uuid, name })) prompts.outro(`${color.green(t('Running'))}  ${color.dim(`(${elapsed(started)})`)} · ${color.cyan('idem services')}`);
}

/** `registry/org/app:v1` → image and tag (a port in the registry host is not a tag). */
function splitImage(ref: string): [string, string | undefined] {
  const colon = ref.lastIndexOf(':');
  return colon > ref.lastIndexOf('/') ? [ref.slice(0, colon), ref.slice(colon + 1)] : [ref, undefined];
}

/** Followed to its end, live — or handed back at once with --detach. Ends with a summary. */
async function follow(
  applicationUuid: string,
  name: string,
  deploymentUuid: string,
  url: string | null,
  opts: DeployOptions,
  started: number,
  linked: { key: string; resource: string }[] = []
): Promise<void> {
  if (opts.detach) {
    if (!printJson({ deploymentUuid, applicationUuid, url })) {
      prompts.outro(t('Deployment queued. Follow it with {command}', { command: color.cyan('idem status') }) + (url ? ` · ${color.cyan(url)}` : ''));
    }
    return;
  }
  if (!isJson()) prompts.log.step(`${t('Deploying {name}', { name: color.bold(name) })} ${color.dim(`(${deploymentUuid.slice(0, 8)})`)}`);
  const final = await followDeployment(deploymentUuid, { quiet: isJson() });
  const address = final.application_url ?? url;
  if (final.status === 'finished') {
    if (printJson({ status: 'finished', deploymentUuid, applicationUuid, url: address, linkedVariables: linked })) return;
    const label = (text: string) => color.dim(t(text).padEnd(14));
    prompts.note(
      [
        `${label('Address')} ${address ? color.cyan(color.bold(address)) : '—'}`,
        `${label('Duration')} ${elapsed(started)}`,
        ...(linked.length ? [`${label('Linked')} ${linked.map((v) => `${v.key} → ${v.resource}`).join(', ')}`] : []),
        '',
        `${label('Next')} ${color.cyan('idem logs -f')}  ${color.cyan('idem open')}  ${color.cyan('idem status')}`,
      ].join('\n'),
      color.green(t('{name} is live', { name }))
    );
    prompts.outro(t('Done.'));
    return;
  }
  if (printJson({ status: final.status, deploymentUuid, applicationUuid, url: address })) process.exit(1);
  fail(
    final.status === 'cancelled-by-user' ? t('The deployment was cancelled.') : t('The deployment failed — the cause is in the log above.'),
    t('The previous version, if any, is still the one serving. Logs: {logs} · page: {page}', { logs: color.cyan('idem logs'), page: color.cyan('idem open --dashboard') })
  );
}
