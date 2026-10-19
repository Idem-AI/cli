/**
 * idem — deploy to iDeploy from your terminal.
 *
 *   idem deploy        the one command: sign in, link, send, follow, address
 *   idem               a menu, when you do not remember the command
 */
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { run, setJson, interactive } from './ui.js';
import { login, logout, whoami } from './commands/auth.js';
import { deploy } from './commands/deploy.js';
import { apps, dashboard, deployments, destroy, domainsAdd, domainsList, domainsRemove, link, open, restart, startStop, status, unlink } from './commands/apps.js';
import { serversAdd, serversCheck, serversList, serversRemove, serversSetup } from './commands/servers.js';
import { workspacesCreate, workspacesList, workspacesRemove, workspacesShow } from './commands/workspaces.js';
import { dbAction, dbBackup, dbCreate, dbList, dbRemove, dbShow, ENGINES } from './commands/databases.js';
import { servicesAction, servicesList, servicesRemove, templatesList } from './commands/services.js';
import { logs } from './commands/logs.js';
import { rollback } from './commands/rollback.js';
import { envList, envPull, envRemove, envSet } from './commands/env.js';
import { menu } from './commands/menu.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const program = new Command();
program
  .name('idem')
  .description('Deploy to iDeploy from your terminal. Start with: idem deploy')
  .version(version, '-v, --version')
  .option('--json', 'machine-readable output (scripts, CI)')
  .hook('preAction', (_program, action) => setJson(Boolean(action.optsWithGlobals().json)))
  .action(
    run(async () => {
      if (!interactive()) return void program.help();
      await menu();
    })
  );

program
  .command('deploy')
  .description('Deploy — this folder by default; creates the application the first time')
  .option('-a, --app <name>', 'deploy to this application (name or id)')
  .option('--git <url>', 'deploy a Git repository instead of this folder')
  .option('--branch <branch>', 'its branch (default: the default branch)')
  .option('--image <ref>', 'run an image from a registry (registry/org/app:tag)')
  .option('--tag <tag>', 'the image tag to deploy')
  .option('--registry-user <user>', 'private registry login (password in IDEM_REGISTRY_PASSWORD)')
  .option('--compose <file>', 'deploy a docker-compose.yml as a service')
  .option('--template <name>', 'deploy a service of the catalogue (see idem templates)')
  .option('-w, --workspace <name>', 'workspace of a new application (created if needed)')
  .option('--server <name>', 'a new workspace runs on this server of yours')
  .option('--region <code>', "a new workspace runs on IDEM's infrastructure in this region")
  .option('-n, --name <name>', 'name of a new application (default: the folder name)')
  .option('--base-dir <dir>', 'the application folder inside a monorepo')
  .option('--install <command>', 'install command')
  .option('--build <command>', 'build command')
  .option('--start <command>', 'start command')
  .option('--port <port>', 'the port the application listens on')
  .option('--publish-dir <dir>', 'the built folder of a static site')
  .option('--env [file]', 'send the variables of .env (or of this file) with a new application')
  .option('--upload', 'send this folder even to an application that deploys from Git or an image')
  .option('-y, --yes', 'ask nothing: defaults everywhere (CI)')
  .option('-d, --detach', 'queue the deployment and return without following it')
  .action(run(deploy));

program.command('login').description('Sign in through the browser').option('--token <token>', 'sign in with an API token instead (CI)').option('--api <url>', 'another iDeploy instance').action(run(login));
program.command('logout').description('Sign out and revoke this machine\'s token').action(run(logout));
program.command('whoami').description('Who you are signed in as').action(run(whoami));

program.command('apps').alias('ls').description('Your applications').action(run(apps));
program.command('link').description('Link this folder to an existing application').option('-a, --app <name>', 'the application').action(run(link));
program.command('unlink').description('Forget which application this folder deploys to').action(run(unlink));
program.command('status').description('Status of the application and its last deployment').option('-a, --app <name>').action(run(status));
program
  .command('logs')
  .description('What the running application prints')
  .option('-a, --app <name>')
  .option('-f, --follow', 'keep printing new lines')
  .option('-n, --lines <count>', 'how many of the last lines', '200')
  .action(run(logs));
program.command('open').description('Open the application in the browser').option('-a, --app <name>').option('--dashboard', 'open its page on iDeploy instead').action(run(open));
program.command('dashboard').description('Open iDeploy in the browser').action(run(dashboard));
program.command('start').description('Start a stopped application').option('-a, --app <name>').action(run((o: { app?: string }) => startStop('start', o)));
program.command('stop').description('Stop the application').option('-a, --app <name>').option('-y, --yes').action(run((o: { app?: string; yes?: boolean }) => startStop('stop', o)));
program.command('destroy').description('Delete the application, its data and its address').option('-a, --app <name>').option('-y, --yes').action(run(destroy));
program.command('deployments').description('Deployment history').option('-a, --app <name>').action(run(deployments));
program.command('restart').description('Restart the application').option('-a, --app <name>').option('-y, --yes', 'do not ask').action(run(restart));
program
  .command('rollback')
  .description('Go back to an earlier version')
  .option('-a, --app <name>')
  .option('--to <deployment>', 'the deployment to go back to (id, or its first characters)')
  .option('-y, --yes', 'the previous version, without asking')
  .option('-d, --detach', 'do not follow it')
  .action(run(rollback));

const env = program.command('env').description('Variables of the application');
env.command('ls', { isDefault: true }).description('List them (values hidden)').option('-a, --app <name>').option('--reveal', 'show the values').action(run(envList));
env.command('set').description('Set KEY=value…').argument('<pairs...>').option('-a, --app <name>').action(run(envSet));
env.command('rm').description('Remove variables').argument('<keys...>').option('-a, --app <name>').action(run(envRemove));
env.command('pull').description('Write them to a local .env').argument('[file]').option('-a, --app <name>').option('-y, --yes', 'replace an existing file').action(run(envPull));

const domains = program.command('domains').description('Addresses of the application');
domains.command('ls', { isDefault: true }).description('Its addresses, with DNS and HTTPS state').option('-a, --app <name>').action(run(domainsList));
domains.command('add').description('Add your domain (it becomes the main address)').argument('<domain>').option('-a, --app <name>').action(run(domainsAdd));
domains.command('rm').description('Remove an address').argument('<domain>').option('-a, --app <name>').action(run(domainsRemove));

const servers = program.command('servers').description('Your own servers (IDEM-managed ones need nothing)');
servers.command('ls', { isDefault: true }).description('List them').action(run(serversList));
servers
  .command('add')
  .description('Add a server: SSH key, checks, Docker and proxy installed')
  .option('--name <name>')
  .option('--ip <address>')
  .option('--port <port>', 'SSH port', '22')
  .option('--user <user>', 'SSH user', 'root')
  .option('--key <file>', 'a private key of yours (default: a new key is generated)')
  .option('--no-setup', 'do not install Docker and the proxy')
  .action(run(serversAdd));
servers.command('check').description('Can iDeploy deploy there?').argument('[server]').action(run((s?: string) => serversCheck(s, { setup: true })));
servers.command('setup').description('Install Docker and the proxy').argument('[server]').action(run(serversSetup));
servers.command('rm').description('Remove a server from iDeploy').argument('[server]').option('-y, --yes').action(run(serversRemove));

const workspaces = program.command('workspaces').alias('ws').description('Workspaces: where applications and databases run together');
workspaces.command('ls', { isDefault: true }).description('List them').action(run(workspacesList));
workspaces
  .command('create')
  .description("Create one — on IDEM's infrastructure or on your server")
  .argument('[name]')
  .option('--server <name>', 'on this server of yours')
  .option('--region <code>', "on IDEM's infrastructure, in this region")
  .option('--description <text>')
  .action(run(workspacesCreate));
workspaces.command('show').description('What runs in it, and how its parts reach each other').argument('[workspace]').action(run(workspacesShow));
workspaces.command('rm').description('Delete an empty workspace').argument('[workspace]').option('-y, --yes').action(run(workspacesRemove));

const db = program.command('db').description(`Databases, caches and queues (${ENGINES.join(', ')})`);
db.command('ls', { isDefault: true }).description('List them').action(run(dbList));
db.command('create').description('Create one in a workspace, and start it').argument('[engine]').option('--name <name>').option('-w, --workspace <name>').option('--no-start', 'only create it').action(run(dbCreate));
db.command('show').description('Address and credentials').argument('[database]').option('--reveal', 'show the secrets').action(run(dbShow));
for (const action of ['start', 'stop', 'restart'] as const) {
  db.command(action).description(`${action[0].toUpperCase()}${action.slice(1)} it`).argument('[database]').action(run((d?: string) => dbAction(action, d)));
}
db.command('backup').description('Back it up now').argument('[database]').action(run(dbBackup));
db.command('rm').description('Delete it and its data').argument('[database]').option('-y, --yes').action(run(dbRemove));

const services = program.command('services').description('Services: docker-compose stacks and catalogue templates');
services.command('ls', { isDefault: true }).description('List them').action(run(servicesList));
for (const action of ['start', 'stop', 'restart'] as const) {
  services.command(action).description(`${action[0].toUpperCase()}${action.slice(1)} it`).argument('[service]').action(run((s?: string) => servicesAction(action, s)));
}
services.command('rm').description('Delete it, its containers and volumes').argument('[service]').option('-y, --yes').action(run(servicesRemove));
program.command('templates').description('The catalogue of one-click services').argument('[search]').action(run(templatesList));

program.parseAsync(process.argv);
