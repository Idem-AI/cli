/**
 * Where the CLI keeps who you are: ~/.config/idem/config.json, readable by you
 * only. IDEM_TOKEN and IDEM_API_URL override it (CI, another instance).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_API_URL = 'https://ideploy-api.idem.africa';
export const DEFAULT_WEB_URL = 'https://ideploy.idem.africa';

export interface Config {
  apiUrl?: string;
  token?: string;
  user?: { name: string; email: string; team?: string | null };
}

function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'idem', 'config.json');
}

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as Config;
  } catch {
    return {};
  }
}

export function writeConfig(config: Config): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  // An existing file keeps its mode on write: set it again.
  chmodSync(path, 0o600);
}

export function clearConfig(): void {
  const path = configPath();
  if (existsSync(path)) rmSync(path);
}

export function apiUrl(): string {
  return (process.env.IDEM_API_URL || readConfig().apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
}

export function webUrl(): string {
  return (process.env.IDEM_WEB_URL || DEFAULT_WEB_URL).replace(/\/+$/, '');
}

export function token(): string | null {
  return process.env.IDEM_TOKEN || readConfig().token || null;
}
