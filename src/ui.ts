/**
 * How the CLI talks: colours and prompts on a terminal, plain lines (or JSON)
 * when it is piped or runs in CI — a prompt there would hang the job.
 */
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { ApiError } from './api.js';
import { t } from './i18n.js';

export const color = pc;
export const prompts = p;

/** A person at a terminal, who can answer a question. */
export function interactive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
}

let jsonMode = false;
export function setJson(on: boolean): void {
  jsonMode = on;
}
export function isJson(): boolean {
  return jsonMode;
}

/** Prints the result for a script, when --json was asked. Returns whether it did. */
export function printJson(value: unknown): boolean {
  if (!jsonMode) return false;
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  return true;
}

/** Stops with a message the developer can act on, and a non-zero exit code. */
export function fail(message: string, hint?: string): never {
  if (jsonMode) {
    process.stderr.write(JSON.stringify({ error: message }) + '\n');
  } else {
    p.log.error(message);
    if (hint) p.log.info(color.dim(hint));
  }
  process.exit(1);
}

/** A cancelled prompt (Ctrl+C) ends quietly. */
export function unlessCancelled<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel(t('Cancelled.'));
    process.exit(130);
  }
  return value as Exclude<T, symbol>;
}

/** Runs a command, turning API and unexpected errors into a clear message. */
export function run<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) fail(err.message);
      fail((err as Error)?.message ?? String(err));
    }
  };
}

/** The address an application answers at, first one, with its scheme. */
export function appUrl(app: { link?: string | null; fqdn?: string | null }): string | null {
  if (app.link) return app.link;
  const first = app.fqdn?.split(',')[0]?.trim();
  return first ? (first.startsWith('http') ? first : `https://${first}`) : null;
}
