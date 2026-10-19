/**
 * The code sent to iDeploy: the folder as Git would see it — `.gitignore` and
 * `.idemignore` respected, nested ones too — never `.git`, `node_modules` nor
 * an `.env` with secrets. Text as is, binaries as base64, within the limits
 * the API accepts.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ignore, { Ignore } from 'ignore';

/** The API's limits (application-source.service.ts). */
export const MAX_FILES = 3000;
export const MAX_BYTES = 9 * 1024 * 1024;

/** Never sent, whatever the ignore files say. */
const ALWAYS = ['.git/', 'node_modules/', '.idem/', '.DS_Store', 'Thumbs.db', '.env', '.env.*', '!.env.example', '!.env.sample', '!.env.dist', '!.env.template'];

export type PackedFile = string | { base64: string };

export interface Pack {
  files: Record<string, PackedFile>;
  count: number;
  bytes: number;
  /** The largest folders, when the pack is over a limit: what to add to .idemignore. */
  heaviest: { dir: string; bytes: number }[];
  tooLarge: boolean;
}

interface Rule {
  /** The folder the ignore file is in, relative to the root ('' for the root). */
  base: string;
  ig: Ignore;
}

function rulesIn(root: string, dir: string): Rule[] {
  const ig = ignore();
  let found = false;
  for (const name of ['.gitignore', '.idemignore']) {
    try {
      ig.add(readFileSync(join(root, dir, name), 'utf8'));
      found = true;
    } catch {
      /* none here */
    }
  }
  return found ? [{ base: dir, ig }] : [];
}

function ignored(path: string, isDir: boolean, rules: Rule[], always: Ignore): boolean {
  const target = isDir ? `${path}/` : path;
  if (always.ignores(target)) return true;
  for (const { base, ig } of rules) {
    const rel = base ? (target.startsWith(`${base}/`) ? target.slice(base.length + 1) : null) : target;
    if (rel && ig.ignores(rel)) return true;
  }
  return false;
}

/** A binary file has a NUL byte early on; it travels as base64. */
function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

export function packFolder(root: string): Pack {
  const always = ignore().add(ALWAYS);
  const files: Record<string, PackedFile> = {};
  const perDir = new Map<string, number>();
  let count = 0;
  let bytes = 0;

  const walk = (dir: string, rules: Rule[]): void => {
    const here = [...rules, ...rulesIn(root, dir)];
    let entries: string[];
    try {
      entries = readdirSync(join(root, dir)).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const path = dir ? `${dir}/${name}` : name;
      let stat;
      try {
        stat = lstatSync(join(root, path));
      } catch {
        continue;
      }
      // Links are not followed: one could point anywhere on this machine.
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (!ignored(path, true, here, always)) walk(path, here);
        continue;
      }
      if (!stat.isFile() || ignored(path, false, here, always)) continue;
      count++;
      bytes += stat.size;
      const top = path.includes('/') ? path.split('/')[0] : '.';
      perDir.set(top, (perDir.get(top) ?? 0) + stat.size);
      if (count > MAX_FILES || bytes > MAX_BYTES) continue;
      const content = readFileSync(join(root, path));
      files[path] = isBinary(content) ? { base64: content.toString('base64') } : content.toString('utf8');
    }
  };
  walk('', []);

  const heaviest = [...perDir.entries()]
    .map(([dir, size]) => ({ dir, bytes: size }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);
  return { files, count, bytes, heaviest, tooLarge: count > MAX_FILES || bytes > MAX_BYTES };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
