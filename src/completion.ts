/**
 * `idem completion bash|zsh|fish` — tab completion of the commands, their
 * sub-commands and options, generated from the CLI itself so it never lags.
 *
 *   bash:  idem completion bash >> ~/.bashrc
 *   zsh:   idem completion zsh  >> ~/.zshrc
 *   fish:  idem completion fish > ~/.config/fish/completions/idem.fish
 */
import type { Command } from 'commander';
import { fail } from './ui.js';
import { t } from './i18n.js';

interface Tree {
  name: string;
  description: string;
  options: string[];
  subcommands: Tree[];
}

function treeOf(cmd: Command): Tree {
  return {
    name: cmd.name(),
    description: cmd.description().replace(/'/g, ''),
    options: cmd.options.map((o) => o.long ?? o.short ?? '').filter(Boolean),
    subcommands: cmd.commands.map(treeOf),
  };
}

function bash(root: Tree): string {
  const top = root.subcommands.map((c) => c.name).join(' ');
  const cases = root.subcommands
    .map((c) => {
      const subs = c.subcommands.map((s) => s.name).join(' ');
      const opts = [...c.options, ...c.subcommands.flatMap((s) => s.options)].join(' ');
      return `    ${c.name}) subs="${subs}"; opts="${opts} --help --json";;`;
    })
    .join('\n');
  return `# idem completion (bash; zsh through bashcompinit)
_idem() {
  local cur=\${COMP_WORDS[COMP_CWORD]} subs="" opts=""
  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=($(compgen -W "${top} --help --version --json --lang" -- "$cur")); return; fi
  case "\${COMP_WORDS[1]}" in
${cases}
  esac
  if [ "$COMP_CWORD" -eq 2 ] && [ -n "$subs" ] && [[ "$cur" != -* ]]; then COMPREPLY=($(compgen -W "$subs" -- "$cur")); return; fi
  COMPREPLY=($(compgen -W "$opts" -- "$cur"))
}
complete -o default -F _idem idem
`;
}

function zsh(root: Tree): string {
  return `# idem completion (zsh)
autoload -U +X bashcompinit && bashcompinit
${bash(root)}`;
}

function fish(root: Tree): string {
  const lines = ['# idem completion (fish)', 'complete -c idem -f'];
  for (const c of root.subcommands) {
    lines.push(`complete -c idem -n '__fish_use_subcommand' -a '${c.name}' -d '${c.description}'`);
    for (const s of c.subcommands) {
      lines.push(`complete -c idem -n '__fish_seen_subcommand_from ${c.name}' -a '${s.name}' -d '${s.description}'`);
    }
    for (const o of [...c.options, ...c.subcommands.flatMap((s) => s.options)]) {
      if (o.startsWith('--')) lines.push(`complete -c idem -n '__fish_seen_subcommand_from ${c.name}' -l '${o.slice(2)}'`);
    }
  }
  return lines.join('\n') + '\n';
}

export function completion(program: Command, shell: string | undefined): void {
  const root = treeOf(program);
  const scripts: Record<string, (r: Tree) => string> = { bash, zsh, fish };
  const make = scripts[(shell ?? '').toLowerCase()];
  if (!make) fail(t('Which shell? bash, zsh or fish.'), t('Example: idem completion bash >> ~/.bashrc'));
  process.stdout.write(make(root));
}
