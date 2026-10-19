/**
 * Which application this folder deploys to: `.idem/project.json`, written by
 * the first `idem deploy` (or `idem link`) and kept out of Git.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ProjectLink {
  applicationUuid: string;
  applicationName: string;
  workspaceUuid?: string | null;
  workspaceName?: string | null;
}

const DIR = '.idem';
const FILE = 'project.json';

export function readLink(cwd = process.cwd()): ProjectLink | null {
  try {
    const link = JSON.parse(readFileSync(join(cwd, DIR, FILE), 'utf8')) as ProjectLink;
    return link.applicationUuid ? link : null;
  } catch {
    return null;
  }
}

export function writeLink(link: ProjectLink, cwd = process.cwd()): void {
  mkdirSync(join(cwd, DIR), { recursive: true });
  writeFileSync(join(cwd, DIR, FILE), JSON.stringify(link, null, 2) + '\n');
  ignoreInGit(cwd);
}

export function removeLink(cwd = process.cwd()): boolean {
  const path = join(cwd, DIR, FILE);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/** `.idem/` names this machine's link, not the project: kept out of the repository. */
function ignoreInGit(cwd: string): void {
  const gitignore = join(cwd, '.gitignore');
  const content = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  if (/^\/?\.idem\/?\s*$/m.test(content)) return;
  if (!existsSync(join(cwd, '.git')) && !content) return;
  appendFileSync(gitignore, `${content && !content.endsWith('\n') ? '\n' : ''}.idem/\n`);
}
