/** What the running application prints — the last lines, or followed live (-f). */
import { api } from '../api.js';
import { resolveApp, sleep } from '../shared.js';
import { color, fail, isJson } from '../ui.js';
import { t } from '../i18n.js';

interface LogsAnswer {
  container: string | null;
  logs: string;
}

/** `2026-10-18T23:27:44.123456789Z text` → its time and text. */
function split(line: string): { at: string | null; text: string } {
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s?(.*)$/.exec(line);
  return m ? { at: m[1], text: m[2] } : { at: null, text: line };
}

function print(lines: string[]): void {
  for (const line of lines) {
    const { at, text } = split(line);
    if (isJson()) {
      process.stdout.write(JSON.stringify({ at, text }) + '\n');
      continue;
    }
    const time = at ? color.dim(new Date(at).toLocaleTimeString()) + ' ' : '';
    const painted = /\b(error|exception|fatal|SQLSTATE)\b/i.test(text) ? color.red(text) : /\bwarn(ing)?\b/i.test(text) ? color.yellow(text) : text;
    process.stdout.write(time + painted + '\n');
  }
}

export async function logs(opts: { app?: string; follow?: boolean; lines?: string }): Promise<void> {
  const app = await resolveApp(opts.app);
  const tail = Math.min(Math.max(Number(opts.lines) || 200, 1), 2000);
  const first = await api.get<LogsAnswer>(`/applications/${app.uuid}/logs?tail=${tail}`);
  if (!first.container) fail(t('{name} is not running: no container to read.', { name: app.name }), t('Deploy it with `idem deploy`, or see `idem status`.'));
  let lines = first.logs.split('\n').filter(Boolean);
  print(lines);
  if (!opts.follow) return;

  // Following: asks for what came since the last line, and drops the ones already shown at that same instant.
  let last = lines.length ? split(lines[lines.length - 1]).at : null;
  let seenAtLast = new Set(lines.filter((l) => split(l).at === last));
  for (;;) {
    await sleep(2000);
    const since = last ? `&since=${encodeURIComponent(last)}` : '';
    const next = await api.get<LogsAnswer>(`/applications/${app.uuid}/logs?tail=2000${since}`).catch(() => null);
    if (!next) continue;
    if (!next.container) fail(t('{name} stopped.', { name: app.name }));
    lines = next.logs.split('\n').filter(Boolean).filter((l) => !seenAtLast.has(l));
    if (lines.length === 0) continue;
    print(lines);
    const newest = split(lines[lines.length - 1]).at;
    if (newest !== last) seenAtLast = new Set();
    last = newest ?? last;
    for (const l of lines) if (split(l).at === last) seenAtLast.add(l);
  }
}
