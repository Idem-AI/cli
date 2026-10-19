/**
 * `idem deploy` — the one command. Signs in if needed, links the folder to an
 * application (creating it the first time), sends the code, follows the
 * deployment and ends with the address — or with why it failed.
 */
import { basename, join } from 'node:path';
import { api, ApiError, Application, Workspace } from '../api.js';
import { token } from '../config.js';
import { formatBytes, MAX_BYTES, MAX_FILES, packFolder } from '../pack.js';
import { readLink, removeLink, writeLink } from '../project.js';
import { appNameFrom, elapsed, followDeployment, listApps, readEnvFile, resolveApp } from '../shared.js';
import { appUrl, color, fail, interactive, isJson, printJson, prompts, unlessCancelled } from '../ui.js';
import { browserLogin } from './auth.js';

export interface DeployOptions {
  app?: string;
  workspace?: string;
  name?: string;
  yes?: boolean;
  detach?: boolean;
  env?: boolean;
}

interface QuickDeployResult {
  deploymentUuid?: string;
  applicationUuid?: string;
  url?: string | null;
  workspace: { uuid: string; name: string };
  linkedVariables?: { key: string; resource: string }[];
}

const NEW_WORKSPACE = '__new__';

export async function deploy(opts: DeployOptions): Promise<void> {
  const started = Date.now();
  const cwd = process.cwd();
  const ask = interactive() && !opts.yes && !isJson();
  if (!isJson()) prompts.intro(color.bgCyan(color.black(' idem deploy ')));

  // 1. Signed in — through the browser, right here, when it is the first time.
  if (!token()) {
    if (!interactive()) fail('You are not signed in.', 'In CI, set IDEM_TOKEN (Security › API tokens on iDeploy).');
    await browserLogin();
  }

  // 2. The code, as Git would see it.
  const spin = isJson() ? null : prompts.spinner();
  spin?.start('Reading the project');
  const pack = packFolder(cwd);
  if (pack.count === 0) {
    spin?.stop('Nothing to send.', 1);
    fail('This folder has no file to deploy.', 'Run `idem deploy` in your project folder.');
  }
  if (pack.tooLarge) {
    spin?.stop('Too large to send.', 1);
    const heavy = pack.heaviest.map((h) => `  ${h.dir}  ${formatBytes(h.bytes)}`).join('\n');
    fail(
      `The project is ${formatBytes(pack.bytes)} in ${pack.count} files: iDeploy takes up to ${formatBytes(MAX_BYTES)} and ${MAX_FILES} files from the CLI.`,
      `The heaviest folders:\n${heavy}\nAdd what the build does not need to .idemignore (same syntax as .gitignore), or deploy from Git on iDeploy.`
    );
  }
  spin?.stop(`Project read: ${pack.count} files, ${formatBytes(pack.bytes)}`);

  // 3. Which application: --app, the folder's link, else a new one.
  let target: Application | null = null;
  if (opts.app) {
    target = await resolveApp(opts.app);
    writeLink({ applicationUuid: target.uuid, applicationName: target.name, workspaceUuid: target.workspace_uuid, workspaceName: target.workspace_name });
  } else {
    const link = readLink();
    if (link) {
      target = await api.get<Application>(`/applications/${link.applicationUuid}`).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      });
      if (!target) {
        removeLink();
        prompts.log.warn(`"${link.applicationName}" no longer exists on iDeploy: a new application is created.`);
      }
    } else if (ask) {
      // A folder deployed before from another machine: offer the application of the same name.
      const name = appNameFrom(basename(cwd));
      const same = (await listApps()).filter((a) => a.name.toLowerCase() === name);
      if (same.length > 0) {
        const choice = unlessCancelled(
          await prompts.select({
            message: `An application "${name}" exists already. Deploy this folder to it?`,
            options: [
              ...same.map((a) => ({ value: a.uuid, label: `Yes — ${a.name}`, hint: a.workspace_name ?? undefined })),
              { value: '', label: 'No — create a new application' },
            ],
          })
        );
        if (choice) {
          target = same.find((a) => a.uuid === choice)!;
          writeLink({ applicationUuid: target.uuid, applicationName: target.name, workspaceUuid: target.workspace_uuid, workspaceName: target.workspace_name });
        }
      }
    }
  }

  let deploymentUuid: string;
  let applicationUuid: string;
  let applicationName: string;
  let url: string | null = null;

  if (target) {
    // 4a. An existing application: its code is replaced, a deployment queued.
    spin?.start(`Sending the code to ${color.bold(target.name)}`);
    const sent = await api.put<{ deploymentUuid: string | null }>(`/applications/${target.uuid}/source`, { files: pack.files, deploy: true });
    if (!sent.deploymentUuid) {
      spin?.stop('Code sent, but no deployment was queued.', 1);
      fail('iDeploy did not queue a deployment.');
    }
    spin?.stop(`Code sent to ${color.bold(target.name)}`);
    deploymentUuid = sent.deploymentUuid;
    applicationUuid = target.uuid;
    applicationName = target.name;
    url = appUrl(target);
  } else {
    // 4b. A new application: its name, its workspace, its variables.
    let name = appNameFrom(opts.name ?? basename(cwd));
    if (ask && !opts.name) {
      name = appNameFrom(
        unlessCancelled(
          await prompts.text({
            message: 'Name of the application',
            initialValue: name,
            validate: (v) => (appNameFrom(v) ? undefined : 'Letters, digits and dashes.'),
          })
        )
      );
    }

    let workspace: { workspace_uuid?: string; workspace_name?: string } = { workspace_name: opts.workspace ?? name };
    if (opts.workspace) {
      const found = (await api.get<Workspace[]>('/workspaces')).find(
        (w) => w.uuid === opts.workspace || w.name.toLowerCase() === opts.workspace!.toLowerCase()
      );
      workspace = found ? { workspace_uuid: found.uuid } : { workspace_name: opts.workspace };
    } else if (ask) {
      const workspaces = await api.get<Workspace[]>('/workspaces');
      if (workspaces.length > 0) {
        const choice = unlessCancelled(
          await prompts.select({
            message: 'Workspace (its databases are linked automatically)',
            options: [
              { value: NEW_WORKSPACE, label: `New workspace "${name}"` },
              ...workspaces.map((w) => ({ value: w.uuid, label: w.name })),
            ],
          })
        );
        workspace = choice === NEW_WORKSPACE ? { workspace_name: name } : { workspace_uuid: String(choice) };
      }
    }

    // The .env holds this machine's values: sent only when the developer agrees.
    let environment_variables: { key: string; value: string }[] = [];
    const local = readEnvFile(join(cwd, '.env'));
    if (local && local.length > 0) {
      let send = Boolean(opts.env);
      if (ask && !opts.env) {
        send = unlessCancelled(
          await prompts.confirm({
            message: `Send the ${local.length} variables of .env? (${local
              .slice(0, 4)
              .map((v) => v.key)
              .join(', ')}${local.length > 4 ? '…' : ''}) — iDeploy replaces local addresses by its own databases`,
            initialValue: true,
          })
        );
      }
      if (send) environment_variables = local;
    }

    spin?.start(`Creating ${color.bold(name)} and sending the code`);
    const created = await api.post<QuickDeployResult>('/quick-deploy', {
      name,
      ...workspace,
      files: pack.files,
      environment_variables,
    });
    if (!created.applicationUuid || !created.deploymentUuid) {
      spin?.stop('Not created.', 1);
      fail('iDeploy did not create the application.');
    }
    spin?.stop(`Created ${color.bold(name)} in workspace ${color.bold(created.workspace.name)}`);
    writeLink({ applicationUuid: created.applicationUuid, applicationName: name, workspaceUuid: created.workspace.uuid, workspaceName: created.workspace.name });
    if (created.linkedVariables?.length && !isJson()) {
      prompts.log.info(
        `Linked to the workspace: ${created.linkedVariables.map((v) => `${color.bold(v.key)} → ${v.resource}`).join(', ')}`
      );
    }
    deploymentUuid = created.deploymentUuid;
    applicationUuid = created.applicationUuid;
    applicationName = name;
    url = created.url ?? null;
  }

  if (opts.detach) {
    if (!printJson({ deploymentUuid, applicationUuid, url })) {
      prompts.outro(`Deployment queued. Follow it with ${color.cyan('idem status')}${url ? ` · ${color.cyan(url)}` : ''}`);
    }
    return;
  }

  // 5. Followed to its end, live.
  if (!isJson()) prompts.log.step(`Deploying ${color.bold(applicationName)} ${color.dim(`(${deploymentUuid.slice(0, 8)})`)}`);
  const final = await followDeployment(deploymentUuid, { quiet: isJson() });
  url = final.application_url ?? url;

  if (final.status === 'finished') {
    if (!printJson({ status: 'finished', deploymentUuid, applicationUuid, url })) {
      prompts.outro(`${color.green('Live')}${url ? ` at ${color.cyan(color.bold(url))}` : ''}  ${color.dim(`(${elapsed(started)})`)}`);
    }
    return;
  }
  if (printJson({ status: final.status, deploymentUuid, applicationUuid, url })) process.exit(1);
  fail(
    final.status === 'cancelled-by-user' ? 'The deployment was cancelled.' : 'The deployment failed — the cause is in the log above.',
    `The previous version, if any, is still the one serving. Logs: ${color.cyan('idem logs')} · page: ${color.cyan('idem open --dashboard')}`
  );
}
