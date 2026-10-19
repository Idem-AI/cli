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
  if (given.length > 1) fail(`Choose one source: --${given.join(', --')}.`);
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
    if (!interactive()) fail('You are not signed in.', 'In CI, set IDEM_TOKEN (Security › API tokens on iDeploy).');
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
    prompts.log.warn(`"${saved.applicationName}" no longer exists on iDeploy: a new application is created.`);
    return null;
  }
  if (!ask) return null;
  const name = appNameFrom(basename(cwd));
  const same = (await listApps()).filter((a) => a.name.toLowerCase() === name);
  if (same.length === 0) return null;
  const choice = unlessCancelled(
    await prompts.select({
      message: `An application "${name}" exists already. Deploy this folder to it?`,
      options: [
        ...same.map((a) => ({ value: a.uuid, label: `Yes — ${a.name}`, hint: a.workspace_name ?? undefined })),
        { value: '', label: 'No — create a new application' },
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
  spin?.start('Reading the project');
  const pack = packFolder(cwd);
  if (pack.count === 0) {
    spin?.stop('Nothing to send.', 1);
    fail('This folder has no file to deploy.', 'Run `idem deploy` in your project folder, or deploy a source: --git, --image, --compose, --template.');
  }
  if (pack.tooLarge) {
    spin?.stop('Too large to send.', 1);
    const heavy = pack.heaviest.map((h) => `  ${h.dir}  ${formatBytes(h.bytes)}`).join('\n');
    fail(
      `The project is ${formatBytes(pack.bytes)} in ${pack.count} files: the CLI sends up to ${formatBytes(MAX_BYTES)} and ${MAX_FILES} files.`,
      `The heaviest folders:\n${heavy}\nAdd what the build does not need to .idemignore (as .gitignore), or deploy from Git: idem deploy --git <url>.`
    );
  }
  spin?.stop(`Project read: ${pack.count} files, ${formatBytes(pack.bytes)}`);
  return pack;
}

/** An existing application: its code is replaced (a folder), or it is rebuilt from its own source. */
async function redeploy(app: Application, opts: DeployOptions, started: number): Promise<void> {
  const fromGit = Boolean(app.git_repository) && app.build_pack !== 'dockerimage';
  const fromImage = app.build_pack === 'dockerimage';
  let deploymentUuid: string;

  if ((fromGit || fromImage) && !opts.upload) {
    // Its source is a repository or an image: sending this folder would replace it.
    const what = fromImage ? `its image${opts.tag ? ` (tag ${opts.tag})` : ''}` : `its repository${app.git_repository ? ` ${color.dim(app.git_repository)}` : ''}`;
    if (!isJson()) prompts.log.info(`${color.bold(app.name)} deploys from ${what}. ${color.dim('(--upload sends this folder instead)')}`);
    const queued = await api.post<{ deploymentUuid: string }>('/deploy', { uuid: app.uuid, ...(opts.tag ? { image_tag: opts.tag } : {}) });
    deploymentUuid = queued.deploymentUuid;
  } else {
    const pack = readProject(process.cwd());
    const spin = isJson() ? null : prompts.spinner();
    spin?.start(`Sending the code to ${color.bold(app.name)}`);
    const sent = await api.put<{ deploymentUuid: string | null }>(`/applications/${app.uuid}/source`, { files: pack.files, deploy: true });
    if (!sent.deploymentUuid) {
      spin?.stop('Code sent, but no deployment was queued.', 1);
      fail('iDeploy did not queue a deployment.');
    }
    spin?.stop(`Code sent to ${color.bold(app.name)}`);
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
          message: 'Workspace (its databases are linked automatically)',
          options: [
            { value: NEW_WORKSPACE, label: `New workspace "${name}"` },
            ...workspaces.map((w) => ({
              value: w.uuid,
              label: w.name,
              hint: w.deploymentType === 'own' ? `your server ${w.assignedServerName ?? ''}`.trim() : 'IDEM',
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
  if (typeof opts.env === 'string' && !local) fail(`Cannot read ${opts.env}.`);
  if (!local || local.length === 0) return [];
  if (opts.env) return local;
  if (!ask) return [];
  const send = unlessCancelled(
    await prompts.confirm({
      message: `Send the ${local.length} variables of .env? (${local
        .slice(0, 4)
        .map((v) => v.key)
        .join(', ')}${local.length > 4 ? '…' : ''}) — iDeploy replaces local addresses by its own databases`,
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
        await prompts.text({ message: 'Name', initialValue: name, validate: (v) => (appNameFrom(v) ? undefined : 'Letters, digits and dashes.') })
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
  if (opts.registryUser && !registry_password) fail('Give the registry password in IDEM_REGISTRY_PASSWORD (never on the command line).');

  const spin = isJson() ? null : prompts.spinner();
  spin?.start(`Creating ${color.bold(name)}`);
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
    spin?.stop('Not created.', 1);
    fail('iDeploy did not create the application.');
  }
  spin?.stop(`Created ${color.bold(name)} in workspace ${color.bold(created.workspace.name)}`);
  if (source === 'folder') {
    writeLink({ applicationUuid: created.applicationUuid, applicationName: name, workspaceUuid: created.workspace.uuid, workspaceName: created.workspace.name });
  }
  if (created.linkedVariables?.length && !isJson()) {
    prompts.log.info(`Linked to the workspace: ${created.linkedVariables.map((v) => `${color.bold(v.key)} → ${v.resource}`).join(', ')}`);
  }
  await follow(created.applicationUuid, name, created.deploymentUuid, created.url ?? null, opts, started);
}

/** A compose file or a catalogue template: a service, started at once. */
async function createService(source: 'compose' | 'template', opts: DeployOptions, ask: boolean, started: number): Promise<void> {
  const fallback = source === 'template' ? opts.template! : basename(process.cwd());
  const name = await nameFor(opts, ask, fallback);
  let workspace = await workspaceFor(name, opts, ask);
  const environment_variables = await variablesFor(opts, ask);
  const spin = isJson() ? null : prompts.spinner();

  if (source === 'template') {
    spin?.start(`Deploying the template ${color.bold(opts.template!)}`);
    const created = await api.post<QuickDeployResult>('/quick-deploy', { name, template: opts.template, ...workspace, environment_variables });
    spin?.stop(`${color.bold(name)} is starting in workspace ${color.bold(created.workspace.name)}`);
    if (!printJson(created)) prompts.outro(`Its address and passwords: ${color.cyan('idem services')} · page on iDeploy: ${color.cyan('idem dashboard')}  ${color.dim(`(${elapsed(started)})`)}`);
    return;
  }

  let compose: string;
  try {
    compose = readFileSync(resolve(opts.compose!), 'utf8');
  } catch {
    fail(`Cannot read ${opts.compose}.`);
  }
  // A service goes into an existing workspace: a new one is created first.
  if (!workspace.workspace_uuid) {
    const { workspace_name, ...where } = workspace;
    const created = await api.post<{ uuid: string; name: string }>('/workspaces', { name: workspace_name, ...where });
    workspace = { workspace_uuid: created.uuid };
  }
  spin?.start(`Creating the service ${color.bold(name)}`);
  const service = await api.post<{ uuid: string; name: string }>('/services', {
    name,
    workspace_uuid: workspace.workspace_uuid,
    docker_compose_raw: compose,
    environment_variables,
  });
  spin?.message(`Starting ${color.bold(name)} (pulling its images)`);
  const result = await api.post<{ success?: boolean; output?: string }>(`/services/${service.uuid}/start`);
  if (result.success === false) {
    spin?.stop(`${name} did not start.`, 1);
    if (result.output && !isJson()) process.stdout.write(color.dim(result.output.split('\n').slice(-20).join('\n')) + '\n');
    fail('The service failed to start — the end of its output is above.', `Fix the compose file, then: idem services restart ${name}`);
  }
  spin?.stop(`${color.bold(name)} is running.`);
  if (!printJson({ serviceUuid: service.uuid, name })) prompts.outro(`${color.green('Running')}  ${color.dim(`(${elapsed(started)})`)} · ${color.cyan('idem services')}`);
}

/** `registry/org/app:v1` → image and tag (a port in the registry host is not a tag). */
function splitImage(ref: string): [string, string | undefined] {
  const colon = ref.lastIndexOf(':');
  return colon > ref.lastIndexOf('/') ? [ref.slice(0, colon), ref.slice(colon + 1)] : [ref, undefined];
}

/** Followed to its end, live — or handed back at once with --detach. */
async function follow(applicationUuid: string, name: string, deploymentUuid: string, url: string | null, opts: DeployOptions, started: number): Promise<void> {
  if (opts.detach) {
    if (!printJson({ deploymentUuid, applicationUuid, url })) {
      prompts.outro(`Deployment queued. Follow it with ${color.cyan('idem status')}${url ? ` · ${color.cyan(url)}` : ''}`);
    }
    return;
  }
  if (!isJson()) prompts.log.step(`Deploying ${color.bold(name)} ${color.dim(`(${deploymentUuid.slice(0, 8)})`)}`);
  const final = await followDeployment(deploymentUuid, { quiet: isJson() });
  const address = final.application_url ?? url;
  if (final.status === 'finished') {
    if (!printJson({ status: 'finished', deploymentUuid, applicationUuid, url: address })) {
      prompts.outro(`${color.green('Live')}${address ? ` at ${color.cyan(color.bold(address))}` : ''}  ${color.dim(`(${elapsed(started)})`)}`);
    }
    return;
  }
  if (printJson({ status: final.status, deploymentUuid, applicationUuid, url: address })) process.exit(1);
  fail(
    final.status === 'cancelled-by-user' ? 'The deployment was cancelled.' : 'The deployment failed — the cause is in the log above.',
    `The previous version, if any, is still the one serving. Logs: ${color.cyan('idem logs')} · page: ${color.cyan('idem open --dashboard')}`
  );
}
