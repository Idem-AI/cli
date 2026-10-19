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
import { apps, dashboard, link, open, restart, status, unlink } from './commands/apps.js';
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
  .description('Deploy this folder — creates the application the first time')
  .option('-a, --app <name>', 'deploy to this application (name or id)')
  .option('-w, --workspace <name>', 'workspace of a new application')
  .option('-n, --name <name>', 'name of a new application (default: the folder name)')
  .option('-y, --yes', 'ask nothing: defaults everywhere (CI)')
  .option('--env', 'send the variables of .env with a new application')
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

program.parseAsync(process.argv);
