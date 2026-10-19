/**
 * `idem` alone: a menu, like Render's — the application of this folder first,
 * then everything else, without remembering a single command.
 */
import { basename } from 'node:path';
import { token } from '../config.js';
import { readLink } from '../project.js';
import { color, prompts, unlessCancelled } from '../ui.js';
import { browserLogin, logout } from './auth.js';
import { deploy } from './deploy.js';
import { apps, dashboard, link, open, restart, status } from './apps.js';
import { logs } from './logs.js';
import { rollback } from './rollback.js';
import { envList } from './env.js';
import { domainsList } from './apps.js';
import { dbList } from './databases.js';
import { workspacesList } from './workspaces.js';
import { serversList } from './servers.js';
import { t } from '../i18n.js';

type Action = 'deploy' | 'logs' | 'status' | 'open' | 'restart' | 'rollback' | 'env' | 'domains' | 'apps' | 'link' | 'db' | 'workspaces' | 'servers' | 'dashboard' | 'logout' | 'quit';

export async function menu(): Promise<void> {
  prompts.intro(color.bgCyan(color.black(' idem ')));
  if (!token()) await browserLogin();
  const linked = readLink();
  const here = linked ? `${color.bold(linked.applicationName)}` : color.bold(basename(process.cwd()));
  // A folder deployed nowhere yet: the one thing to know first.
  if (!linked) {
    prompts.note(
      `${t('This folder is not deployed yet. One command does it all:')}\n\n  ${color.cyan(color.bold('idem deploy'))}\n\n${color.dim(t('Or pick something below. Every command: idem --help'))}`,
      t('Welcome')
    );
  }

  const options: { value: Action; label: string; hint?: string }[] = [
    { value: 'deploy', label: linked ? t('Deploy {name}', { name: linked.applicationName }) : t('Deploy this folder'), hint: 'idem deploy' },
    ...(linked
      ? ([
          { value: 'logs', label: t('Logs, live'), hint: 'idem logs -f' },
          { value: 'status', label: t('Status'), hint: 'idem status' },
          { value: 'open', label: t('Open in the browser'), hint: 'idem open' },
          { value: 'env', label: t('Variables'), hint: 'idem env' },
          { value: 'domains', label: t('Domains'), hint: 'idem domains' },
          { value: 'restart', label: t('Restart'), hint: 'idem restart' },
          { value: 'rollback', label: t('Back to an earlier version'), hint: 'idem rollback' },
        ] as { value: Action; label: string; hint?: string }[])
      : [{ value: 'link' as Action, label: t('Link this folder to an existing application'), hint: 'idem link' }]),
    { value: 'apps', label: t('All my applications'), hint: 'idem apps' },
    { value: 'db', label: t('Databases, caches, queues'), hint: 'idem db' },
    { value: 'workspaces', label: t('Workspaces'), hint: 'idem workspaces' },
    { value: 'servers', label: t('My servers'), hint: 'idem servers' },
    { value: 'dashboard', label: t('Open iDeploy'), hint: 'idem dashboard' },
    { value: 'logout', label: t('Sign out'), hint: 'idem logout' },
    { value: 'quit', label: t('Quit') },
  ];
  const action = unlessCancelled(
    await prompts.select({ message: linked ? t('This folder deploys to {name}', { name: here }) : t('What do you want to do?'), options })
  ) as Action;

  switch (action) {
    case 'deploy':
      return deploy({});
    case 'logs':
      return logs({ follow: true });
    case 'status':
      return status({});
    case 'open':
      return open({});
    case 'env':
      return envList({});
    case 'restart':
      return restart({});
    case 'rollback':
      return rollback({});
    case 'apps':
      return apps();
    case 'domains':
      return domainsList({});
    case 'db':
      return dbList();
    case 'workspaces':
      return workspacesList();
    case 'servers':
      return serversList();
    case 'link':
      return link({});
    case 'dashboard':
      return dashboard();
    case 'logout':
      return logout();
    case 'quit':
      prompts.outro(t('See you.'));
  }
}
