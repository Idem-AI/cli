/** An application's variables: list (masked), set, remove, write to a local .env. */
import { existsSync, writeFileSync } from 'node:fs';
import { api, EnvVar } from '../api.js';
import { parseEnv, resolveApp } from '../shared.js';
import { color, fail, interactive, printJson, prompts } from '../ui.js';

function mask(value: string): string {
  if (!value) return color.dim('(empty)');
  return value.length <= 4 ? '••••' : `${value.slice(0, 2)}${'•'.repeat(Math.min(value.length - 2, 10))}`;
}

export async function envList(opts: { app?: string; reveal?: boolean }): Promise<void> {
  const app = await resolveApp(opts.app);
  const vars = await api.get<EnvVar[]>(`/applications/${app.uuid}/envs`);
  if (printJson(opts.reveal ? vars.map((v) => ({ key: v.key, value: v.value })) : vars.map((v) => ({ key: v.key })))) return;
  if (vars.length === 0) return void prompts.log.info(`${app.name} has no variable.`);
  const width = Math.min(Math.max(...vars.map((v) => v.key.length)), 40);
  process.stdout.write(vars.map((v) => `${v.key.padEnd(width)}  ${opts.reveal ? v.value : mask(v.value)}`).join('\n') + '\n');
  if (!opts.reveal) prompts.log.info(color.dim('Values hidden — --reveal shows them.'));
}

export async function envSet(pairs: string[], opts: { app?: string }): Promise<void> {
  const parsed = parseEnv(pairs.join('\n'));
  if (parsed.length === 0 || parsed.length !== pairs.length) fail('Give variables as KEY=value.', 'Example: idem env set APP_ENV=production MAIL_HOST=smtp.example.com');
  const app = await resolveApp(opts.app);
  for (const v of parsed) await api.post(`/applications/${app.uuid}/envs`, { key: v.key, value: v.value, is_runtime: true });
  if (printJson({ set: parsed.map((v) => v.key) })) return;
  prompts.log.success(`Set ${parsed.map((v) => color.bold(v.key)).join(', ')} on ${app.name}.`);
  prompts.log.info(`They apply at the next deployment: ${color.cyan('idem deploy')} (or redeploy from iDeploy).`);
}

export async function envRemove(keys: string[], opts: { app?: string }): Promise<void> {
  if (keys.length === 0) fail('Which variable?', 'Example: idem env rm OLD_KEY');
  const app = await resolveApp(opts.app);
  for (const key of keys) await api.delete(`/applications/${app.uuid}/envs/${encodeURIComponent(key)}`);
  if (!printJson({ removed: keys })) prompts.log.success(`Removed ${keys.map((k) => color.bold(k)).join(', ')} from ${app.name}.`);
}

/** The deployed values in a local file — never over an existing one without asking. */
export async function envPull(file: string | undefined, opts: { app?: string; yes?: boolean }): Promise<void> {
  const target = file ?? '.env';
  const app = await resolveApp(opts.app);
  if (existsSync(target) && !opts.yes) {
    if (!interactive()) fail(`${target} exists already.`, 'Pass --yes to replace it, or give another file name.');
    const replace = await prompts.confirm({ message: `${target} exists. Replace it?`, initialValue: false });
    if (prompts.isCancel(replace) || !replace) return void prompts.cancel('Kept as it was.');
  }
  const vars = await api.get<EnvVar[]>(`/applications/${app.uuid}/envs`);
  const quote = (v: string) => (/[\s#"'$\\]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"` : v);
  writeFileSync(target, `# ${app.name} — written by idem env pull\n` + vars.map((v) => `${v.key}=${quote(v.value)}`).join('\n') + '\n', { mode: 0o600 });
  if (!printJson({ file: target, count: vars.length })) prompts.log.success(`${vars.length} variables written to ${target}. Keep it out of Git.`);
}
