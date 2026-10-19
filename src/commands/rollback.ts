/** Back to a version that worked: a past deployment, built again. */
import { api } from '../api.js';
import { followDeployment, resolveApp } from '../shared.js';
import { color, fail, interactive, printJson, prompts, unlessCancelled } from '../ui.js';

interface Target {
  deploymentUuid: string;
  commit: string;
  status: string;
  finishedAt: string | null;
}

export async function rollback(opts: { app?: string; to?: string; yes?: boolean; detach?: boolean }): Promise<void> {
  const app = await resolveApp(opts.app);
  const targets = await api.get<Target[]>(`/applications/${app.uuid}/rollback-targets`);
  if (targets.length < 2 && !opts.to) fail(`${app.name} has no earlier version to go back to.`);

  let chosen = opts.to ? targets.find((t) => t.deploymentUuid.startsWith(opts.to!)) : undefined;
  if (opts.to && !chosen) fail(`No successful deployment "${opts.to}".`);
  if (!chosen) {
    if (!interactive() || opts.yes) {
      chosen = targets[1];
    } else {
      const uuid = unlessCancelled(
        await prompts.select({
          message: 'Back to which version?',
          options: targets.map((t, i) => ({
            value: t.deploymentUuid,
            label: `${t.deploymentUuid.slice(0, 8)}  ${t.commit === 'HEAD' ? '' : t.commit.slice(0, 7)}`,
            hint: `${t.finishedAt ? new Date(t.finishedAt).toLocaleString() : ''}${i === 0 ? ' · current' : ''}`,
          })),
          initialValue: targets[1]?.deploymentUuid,
        })
      );
      chosen = targets.find((t) => t.deploymentUuid === uuid)!;
    }
  }

  const started = await api.post<{ deploymentUuid: string }>(`/applications/${app.uuid}/rollback`, { deployment_uuid: chosen.deploymentUuid });
  if (opts.detach) {
    if (!printJson(started)) prompts.log.success(`Rollback queued (${started.deploymentUuid.slice(0, 8)}).`);
    return;
  }
  prompts.log.step(`Rolling ${color.bold(app.name)} back to ${chosen.deploymentUuid.slice(0, 8)}`);
  const final = await followDeployment(started.deploymentUuid);
  if (final.status !== 'finished') fail('The rollback failed — the cause is in the log above.');
  prompts.outro(`${color.green('Back')} on ${chosen.deploymentUuid.slice(0, 8)}${final.application_url ? ` · ${color.cyan(final.application_url)}` : ''}`);
}
