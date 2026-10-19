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

type Action = 'deploy' | 'logs' | 'status' | 'open' | 'restart' | 'rollback' | 'env' | 'domains' | 'apps' | 'link' | 'db' | 'workspaces' | 'servers' | 'dashboard' | 'logout' | 'quit';

export async function menu(): Promise<void> {
  prompts.intro(color.bgCyan(color.black(' idem ')));
  if (!token()) await browserLogin();
  const linked = readLink();
  const here = linked ? `${color.bold(linked.applicationName)}` : color.bold(basename(process.cwd()));

  const options: { value: Action; label: string; hint?: string }[] = [
    { value: 'deploy', label: linked ? `Deploy ${linked.applicationName}` : `Deploy this folder`, hint: 'idem deploy' },
    ...(linked
      ? ([
          { value: 'logs', label: 'Logs, live', hint: 'idem logs -f' },
          { value: 'status', label: 'Status', hint: 'idem status' },
          { value: 'open', label: 'Open in the browser', hint: 'idem open' },
          { value: 'env', label: 'Variables', hint: 'idem env' },
          { value: 'domains', label: 'Domains', hint: 'idem domains' },
          { value: 'restart', label: 'Restart', hint: 'idem restart' },
          { value: 'rollback', label: 'Back to an earlier version', hint: 'idem rollback' },
        ] as { value: Action; label: string; hint?: string }[])
      : [{ value: 'link' as Action, label: 'Link this folder to an existing application', hint: 'idem link' }]),
    { value: 'apps', label: 'All my applications', hint: 'idem apps' },
    { value: 'db', label: 'Databases, caches, queues', hint: 'idem db' },
    { value: 'workspaces', label: 'Workspaces', hint: 'idem workspaces' },
    { value: 'servers', label: 'My servers', hint: 'idem servers' },
    { value: 'dashboard', label: 'Open iDeploy', hint: 'idem dashboard' },
    { value: 'logout', label: 'Sign out', hint: 'idem logout' },
    { value: 'quit', label: 'Quit' },
  ];
  const action = unlessCancelled(
    await prompts.select({ message: linked ? `This folder deploys to ${here}` : 'What do you want to do?', options })
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
      prompts.outro('See you.');
  }
}
