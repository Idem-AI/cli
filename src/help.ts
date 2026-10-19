/**
 * The help a developer reads first: commands grouped by what they are for,
 * the few examples that cover most needs, and where to read more. Each
 * command's own help (`idem deploy --help`) ends with its examples.
 */
import type { Command } from 'commander';
import { color } from './ui.js';
import { t } from './i18n.js';

export const DOCS_URL = 'https://github.com/Idem-AI/cli#readme';

const GROUPS: { title: string; commands: string[] }[] = [
  { title: 'Deploy', commands: ['deploy', 'templates'] },
  { title: 'Application', commands: ['apps', 'status', 'logs', 'deployments', 'open', 'env', 'domains', 'restart', 'start', 'stop', 'rollback', 'destroy', 'link', 'unlink'] },
  { title: 'Infrastructure', commands: ['workspaces', 'db', 'services', 'servers'] },
  { title: 'Account', commands: ['login', 'logout', 'whoami', 'dashboard', 'completion'] },
];

export function rootHelp(program: Command, version: string): string {
  const byName = new Map(program.commands.map((c) => [c.name(), c]));
  const width = 14;
  const lines: string[] = [
    '',
    `${color.bgCyan(color.black(' idem '))}  ${color.bold(t('Deploy to iDeploy from your terminal'))}  ${color.dim(`v${version}`)}`,
    '',
    `  ${t('Start here, in your project folder:')}  ${color.cyan(color.bold('idem deploy'))}`,
    `  ${color.dim(t('Not sure? Run idem alone: a menu shows what you can do.'))}`,
  ];
  for (const group of GROUPS) {
    lines.push('', color.bold(t(group.title)));
    for (const name of group.commands) {
      const cmd = byName.get(name);
      if (!cmd) continue;
      lines.push(`  ${color.cyan(name.padEnd(width))} ${cmd.description()}`);
    }
  }
  lines.push(
    '',
    color.bold(t('Examples')),
    example('idem deploy', 'this folder — creates the application the first time'),
    example('idem deploy --git https://github.com/me/app', 'a Git repository'),
    example('idem deploy --template n8n', 'a one-click service'),
    example('idem logs -f', 'what the application prints, live'),
    example('idem db create postgresql', 'a database, linked at the next deploy'),
    '',
    color.bold(t('Options')),
    `  ${color.cyan('--json'.padEnd(width))} ${t('machine-readable output (scripts, CI)')}`,
    `  ${color.cyan('--lang fr|en'.padEnd(width))} ${t('language (default: your system’s)')}`,
    `  ${color.cyan('-v, --version'.padEnd(width))} ${t('the version')}`,
    '',
    `${t('Every command has its own help:')} ${color.cyan('idem <command> --help')}`,
    `${t('Documentation:')} ${color.cyan(DOCS_URL)}`,
    ''
  );
  return lines.join('\n');
}

function example(command: string, what: string): string {
  return `  ${color.cyan(command)}\n      ${color.dim(t(what))}`;
}

/** "Examples" at the end of a command's help. */
export function withExamples(cmd: Command, examples: [string, string][]): Command {
  return cmd.addHelpText('after', () => `\n${color.bold(t('Examples'))}\n${examples.map(([c, w]) => example(c, w)).join('\n')}\n`);
}
