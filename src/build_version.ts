// Build-time only (imported by vite.config.ts): which commit is being built, for the version on the main menu.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const short = (sha: string) => (/^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : '');

/** The repo's HEAD read straight from .git, for builds (like the Docker image) that have .git but no git binary. */
function readGitDir(root: string): string {
  try {
    const head = readFileSync(`${root}/.git/HEAD`, 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice(5);
    if (existsSync(`${root}/.git/${ref}`)) return readFileSync(`${root}/.git/${ref}`, 'utf8').trim();
    const packed = readFileSync(`${root}/.git/packed-refs`, 'utf8');
    return packed.split('\n').find((l) => l.endsWith(` ${ref}`))?.split(' ')[0] ?? '';
  } catch {
    return '';
  }
}

/** Short commit hash: from the deploy's env (Coolify sets SOURCE_COMMIT), git, or .git itself; '' if none. */
export function buildCommit(root = process.cwd()): string {
  for (const k of ['SOURCE_COMMIT', 'GIT_COMMIT', 'COMMIT_SHA']) {
    const v = short(process.env[k] ?? '');
    if (v) return v;
  }
  try {
    const v = short(execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
    if (v) return v;
  } catch { /* no git binary or not a repo */ }
  return short(readGitDir(root));
}
