/**
 * idem — deploy to iDeploy from your terminal.
 *
 *   idem deploy        the one command: sign in, link, send, follow, address
 *   idem               a menu, when you do not remember the command
 */
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { fail, run, setJson, interactive } from './ui.js';
import { setLang, t } from './i18n.js';
import { rootHelp, withExamples } from './help.js';
import { completion } from './completion.js';
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

// The language is known before the commands are described: their help is translated too.
const langAt = process.argv.findIndex((a) => a === '--lang' || a.startsWith('--lang='));
if (langAt >= 0) {
  const value = (process.argv[langAt].includes('=') ? process.argv[langAt].split('=')[1] : process.argv[langAt + 1])?.toLowerCase();
  if (value === 'fr' || value === 'en') setLang(value);
}

const program = new Command();
program
  .name('idem')
  .description(t('Deploy to iDeploy from your terminal. Start with: idem deploy'))
  .version(version, '-v, --version', t('the version'))
  .option('--json', t('machine-readable output (scripts, CI)'))
  .option('--lang <lang>', t('language: fr or en'))
  .helpOption('-h, --help', t('this help'))
  .addHelpCommand(false)
  .showSuggestionAfterError(true)
  .hook('preAction', (_program, action) => setJson(Boolean(action.optsWithGlobals().json)))
  .action(
    run(async () => {
      // `idem deplo`: a mistyped command, not a reason to open the menu.
      const [typed] = program.args;
      if (typed) {
        const near = closest(typed, program.commands.flatMap((c) => [c.name(), ...c.aliases()]));
        fail(t('Unknown command "{name}".', { name: typed }), near ? t('Did you mean {command}?', { command: `idem ${near}` }) : t('Every command: idem --help'));
      }
      if (!interactive()) return void program.help();
      await menu();
    })
  );
// The first screen: grouped, with examples — not the list a parser prints.
program.helpInformation = () => rootHelp(program, version);

const app = () => ['-a, --app <name>', t('the application (name or id; default: the one of this folder)')] as const;

withExamples(
  program
    .command('deploy')
    .description(t('Deploy — this folder by default; creates the application the first time'))
    .option(...app())
    .option('--git <url>', t('deploy a Git repository instead of this folder'))
    .option('--branch <branch>', t('its branch (default: the default branch)'))
    .option('--image <ref>', t('run an image from a registry (registry/org/app:tag)'))
    .option('--tag <tag>', t('the image tag to deploy'))
    .option('--registry-user <user>', t('private registry login (password in IDEM_REGISTRY_PASSWORD)'))
    .option('--compose <file>', t('deploy a docker-compose.yml as a service'))
    .option('--template <name>', t('deploy a service of the catalogue (see idem templates)'))
    .option('-w, --workspace <name>', t('workspace of a new application (created if needed)'))
    .option('--server <name>', t('a new workspace runs on this server of yours'))
    .option('--region <code>', t("a new workspace runs on IDEM's infrastructure in this region"))
    .option('-n, --name <name>', t('name of a new application (default: the folder name)'))
    .option('--base-dir <dir>', t('the application folder inside a monorepo'))
    .option('--install <command>', t('install command'))
    .option('--build <command>', t('build command'))
    .option('--start <command>', t('start command'))
    .option('--port <port>', t('the port the application listens on'))
    .option('--publish-dir <dir>', t('the built folder of a static site'))
    .option('--env [file]', t('send the variables of .env (or of this file) with a new application'))
    .option('--upload', t('send this folder even to an application that deploys from Git or an image'))
    .option('-y, --yes', t('ask nothing: defaults everywhere (CI)'))
    .option('-d, --detach', t('queue the deployment and return without following it'))
    .action(run(deploy)),
  [
    ['idem deploy', 'this folder — creates the application the first time'],
    ['idem deploy --git https://github.com/me/shop --branch main', 'a Git repository'],
    ['idem deploy --image ghcr.io/me/api:1.4 --port 8080', 'an image already built'],
    ['idem deploy --compose docker-compose.yml', 'your own stack, as a service'],
    ['idem deploy --server my-vps', 'a new application, on one of your servers'],
    ['IDEM_TOKEN=… idem deploy --yes --app shop', 'in CI'],
  ]
);

withExamples(
  program
    .command('login')
    .description(t('Sign in through the browser'))
    .option('--token <token>', t('sign in with an API token instead (CI)'))
    .option('--api <url>', t('another iDeploy instance'))
    .action(run(login)),
  [
    ['idem login', 'opens the browser; check the code, authorise'],
    ['idem login --token 12|abc…', 'with a token from Security › API tokens'],
  ]
);
program.command('logout').description(t("Sign out and revoke this machine's token")).action(run(logout));
program.command('whoami').description(t('Who you are signed in as')).action(run(whoami));

program.command('apps').alias('ls').description(t('Your applications')).action(run(apps));
program.command('link').description(t('Link this folder to an existing application')).option(...app()).action(run(link));
program.command('unlink').description(t('Forget which application this folder deploys to')).action(run(unlink));
program.command('status').description(t('Status of the application and its last deployment')).option(...app()).action(run(status));
withExamples(
  program
    .command('logs')
    .description(t('What the running application prints'))
    .option(...app())
    .option('-f, --follow', t('keep printing new lines'))
    .option('-n, --lines <count>', t('how many of the last lines'), '200')
    .action(run(logs)),
  [
    ['idem logs -f', 'follow it live'],
    ['idem logs -n 1000 --app shop | grep ERROR', 'search the last 1000 lines'],
  ]
);
program.command('open').description(t('Open the application in the browser')).option(...app()).option('--dashboard', t('open its page on iDeploy instead')).action(run(open));
program.command('dashboard').description(t('Open iDeploy in the browser')).action(run(dashboard));
program.command('start').description(t('Start a stopped application')).option(...app()).action(run((o: { app?: string }) => startStop('start', o)));
program.command('stop').description(t('Stop the application')).option(...app()).option('-y, --yes', t('do not ask')).action(run((o: { app?: string; yes?: boolean }) => startStop('stop', o)));
program.command('restart').description(t('Restart the application')).option(...app()).option('-y, --yes', t('do not ask')).action(run(restart));
program.command('destroy').description(t('Delete the application, its data and its address')).option(...app()).option('-y, --yes', t('do not ask')).action(run(destroy));
program.command('deployments').description(t('Deployment history')).option(...app()).action(run(deployments));
withExamples(
  program
    .command('rollback')
    .description(t('Go back to an earlier version'))
    .option(...app())
    .option('--to <deployment>', t('the deployment to go back to (id, or its first characters)'))
    .option('-y, --yes', t('the previous version, without asking'))
    .option('-d, --detach', t('do not follow it'))
    .action(run(rollback)),
  [
    ['idem rollback', 'choose the version in a list'],
    ['idem rollback --yes', 'straight back to the previous one'],
  ]
);

const env = withExamples(program.command('env').description(t('Variables of the application')), [
  ['idem env', 'list them, values hidden'],
  ['idem env set APP_ENV=production MAIL_HOST=smtp.example.com', 'set some; they apply at the next deploy'],
  ['idem env pull .env.local', 'write them to a local file'],
]);
env.command('ls', { isDefault: true }).description(t('List them (values hidden)')).option(...app()).option('--reveal', t('show the values')).action(run(envList));
env.command('set').description(t('Set KEY=value…')).argument('<pairs...>').option(...app()).action(run(envSet));
env.command('rm').description(t('Remove variables')).argument('<keys...>').option(...app()).action(run(envRemove));
env.command('pull').description(t('Write them to a local .env')).argument('[file]').option(...app()).option('-y, --yes', t('replace an existing file')).action(run(envPull));

const domains = withExamples(program.command('domains').description(t('Addresses of the application')), [
  ['idem domains', 'its addresses, with DNS and HTTPS state'],
  ['idem domains add shop.example.com', 'your domain: the DNS record to create is shown'],
]);
domains.command('ls', { isDefault: true }).description(t('Its addresses, with DNS and HTTPS state')).option(...app()).action(run(domainsList));
domains.command('add').description(t('Add your domain (it becomes the main address)')).argument('<domain>').option(...app()).action(run(domainsAdd));
domains.command('rm').description(t('Remove an address')).argument('<domain>').option(...app()).action(run(domainsRemove));

const servers = withExamples(program.command('servers').description(t('Your own servers (IDEM-managed ones need nothing)')), [
  ['idem servers add', 'step by step: address, SSH key, checks, Docker'],
  ['idem servers add --ip 203.0.113.10 --name my-vps --key ~/.ssh/id_ed25519', 'without questions'],
  ['idem servers check my-vps', 'can iDeploy deploy there?'],
]);
servers.command('ls', { isDefault: true }).description(t('List them')).action(run(serversList));
servers
  .command('add')
  .description(t('Add a server: SSH key, checks, Docker and proxy installed'))
  .option('--name <name>', t('its name'))
  .option('--ip <address>', t('its address'))
  .option('--port <port>', t('SSH port'), '22')
  .option('--user <user>', t('SSH user'), 'root')
  .option('--key <file>', t('a private key of yours (default: a new key is generated)'))
  .option('--no-setup', t('do not install Docker and the proxy'))
  .action(run(serversAdd));
servers.command('check').description(t('Can iDeploy deploy there?')).argument('[server]').action(run((s?: string) => serversCheck(s, { setup: true })));
servers.command('setup').description(t('Install Docker and the proxy')).argument('[server]').action(run(serversSetup));
servers.command('rm').description(t('Remove a server from iDeploy')).argument('[server]').option('-y, --yes', t('do not ask')).action(run(serversRemove));

const workspaces = withExamples(
  program.command('workspaces').alias('ws').description(t('Workspaces: where applications and databases run together')),
  [
    ['idem workspaces create shop', "on IDEM's infrastructure (asked on a terminal)"],
    ['idem workspaces create shop --server my-vps', 'on your server'],
    ['idem ws show shop', 'what runs in it, and how its parts reach each other'],
  ]
);
workspaces.command('ls', { isDefault: true }).description(t('List them')).action(run(workspacesList));
workspaces
  .command('create')
  .description(t("Create one — on IDEM's infrastructure or on your server"))
  .argument('[name]')
  .option('--server <name>', t('on this server of yours'))
  .option('--region <code>', t("on IDEM's infrastructure, in this region"))
  .option('--description <text>', t('a description'))
  .action(run(workspacesCreate));
workspaces.command('show').description(t('What runs in it, and how its parts reach each other')).argument('[workspace]').action(run(workspacesShow));
workspaces.command('rm').description(t('Delete an empty workspace')).argument('[workspace]').option('-y, --yes', t('do not ask')).action(run(workspacesRemove));

const db = withExamples(program.command('db').description(t('Databases, caches and queues ({list})', { list: ENGINES.join(', ') })), [
  ['idem db create postgresql -w shop', 'a database in a workspace, started'],
  ['idem db show shop-postgresql --reveal', 'its address and credentials'],
  ['idem db backup shop-postgresql', 'a backup now'],
]);
db.command('ls', { isDefault: true }).description(t('List them')).action(run(dbList));
db.command('create').description(t('Create one in a workspace, and start it')).argument('[engine]').option('--name <name>', t('its name')).option('-w, --workspace <name>', t('its workspace')).option('--no-start', t('only create it')).action(run(dbCreate));
db.command('show').description(t('Address and credentials')).argument('[database]').option('--reveal', t('show the secrets')).action(run(dbShow));
for (const action of ['start', 'stop', 'restart'] as const) {
  const text = { start: 'Start it', stop: 'Stop it', restart: 'Restart it' }[action];
  db.command(action).description(t(text)).argument('[database]').action(run((d?: string) => dbAction(action, d)));
}
db.command('backup').description(t('Back it up now')).argument('[database]').action(run(dbBackup));
db.command('rm').description(t('Delete it and its data')).argument('[database]').option('-y, --yes', t('do not ask')).action(run(dbRemove));

const services = program.command('services').description(t('Services: docker-compose stacks and catalogue templates'));
services.command('ls', { isDefault: true }).description(t('List them')).action(run(servicesList));
for (const action of ['start', 'stop', 'restart'] as const) {
  const text = { start: 'Start it', stop: 'Stop it', restart: 'Restart it' }[action];
  services.command(action).description(t(text)).argument('[service]').action(run((s?: string) => servicesAction(action, s)));
}
services.command('rm').description(t('Delete it, its containers and volumes')).argument('[service]').option('-y, --yes', t('do not ask')).action(run(servicesRemove));
withExamples(program.command('templates').description(t('The catalogue of one-click services')).argument('[search]').action(run(templatesList)), [
  ['idem templates analytics', 'search the catalogue'],
  ['idem deploy --template plausible', 'deploy one'],
]);

withExamples(
  program
    .command('completion')
    .description(t('Tab completion for your shell (bash, zsh, fish)'))
    .argument('[shell]')
    .action((shell?: string) => completion(program, shell)),
  [
    ['idem completion bash >> ~/.bashrc', 'bash'],
    ['idem completion zsh >> ~/.zshrc', 'zsh'],
    ['idem completion fish > ~/.config/fish/completions/idem.fish', 'fish'],
  ]
);

/** The nearest command name, within two edits — else none. */
function closest(word: string, names: string[]): string | null {
  const distance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length];
  };
  let best: { name: string; d: number } | null = null;
  for (const name of names) {
    const d = distance(word.toLowerCase(), name);
    if (d <= 2 && (!best || d < best.d)) best = { name, d };
  }
  return best?.name ?? null;
}

program.parseAsync(process.argv);
