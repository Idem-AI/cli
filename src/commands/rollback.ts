/** Back to a version that worked: a past deployment, built again. */
import { api } from '../api.js';
import { followDeployment, resolveApp } from '../shared.js';
import { color, fail, interactive, printJson, prompts, unlessCancelled } from '../ui.js';
import { t } from '../i18n.js';

interface Target {
  deploymentUuid: string;
  commit: string;
  status: string;
  finishedAt: string | null;
}

export async function rollback(opts: { app?: string; to?: string; yes?: boolean; detach?: boolean }): Promise<void> {
  const app = await resolveApp(opts.app);
  const targets = await api.get<Target[]>(`/applications/${app.uuid}/rollback-targets`);
  if (targets.length < 2 && !opts.to) fail(t('{name} has no earlier version to go back to.', { name: app.name }));

  let chosen = opts.to ? targets.find((t) => t.deploymentUuid.startsWith(opts.to!)) : undefined;
  if (opts.to && !chosen) fail(t('No successful deployment "{id}".', { id: opts.to! }));
  if (!chosen) {
    if (!interactive() || opts.yes) {
      chosen = targets[1];
    } else {
      const uuid = unlessCancelled(
        await prompts.select({
          message: t('Back to which version?'),
          options: targets.map((target, i) => ({
            value: target.deploymentUuid,
            label: `${target.deploymentUuid.slice(0, 8)}  ${target.commit === 'HEAD' ? '' : target.commit.slice(0, 7)}`,
            hint: `${target.finishedAt ? new Date(target.finishedAt).toLocaleString() : ''}${i === 0 ? ` · ${t('current')}` : ''}`,
          })),
          initialValue: targets[1]?.deploymentUuid,
        })
      );
      chosen = targets.find((t) => t.deploymentUuid === uuid)!;
    }
  }

  const started = await api.post<{ deploymentUuid: string }>(`/applications/${app.uuid}/rollback`, { deployment_uuid: chosen.deploymentUuid });
  if (opts.detach) {
    if (!printJson(started)) prompts.log.success(t('Rollback queued ({id}).', { id: started.deploymentUuid.slice(0, 8) }));
    return;
  }
  prompts.log.step(t('Rolling {name} back to {id}', { name: color.bold(app.name), id: chosen.deploymentUuid.slice(0, 8) }));
  const final = await followDeployment(started.deploymentUuid);
  if (final.status !== 'finished') fail(t('The rollback failed — the cause is in the log above.'));
  prompts.outro(color.green(t('Back on {id}', { id: chosen.deploymentUuid.slice(0, 8) })) + (final.application_url ? ` · ${color.cyan(final.application_url)}` : ''));
}
