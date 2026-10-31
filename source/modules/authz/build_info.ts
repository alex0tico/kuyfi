import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Commit of the code that is running, so evidence can be tied to it.
 * `KUYFI_COMMIT` (set by the operator) wins; otherwise the repository the
 * tool was built from is asked. A working tree with local changes is marked
 * `+dirty`. Returns undefined when neither is available (e.g. an installed
 * package without git): the report then simply carries no commit.
 */
export function resolveCommit(
	env: NodeJS.ProcessEnv = process.env,
	run: (args: string[]) => string = args =>
		execFileSync('git', args, {
			cwd: path.dirname(fileURLToPath(import.meta.url)),
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}),
): string | undefined {
	const fromEnv = env['KUYFI_COMMIT']?.trim();
	if (fromEnv) return fromEnv;
	try {
		const sha = run(['rev-parse', 'HEAD']).trim();
		if (!/^[\da-f]{40}$/.test(sha)) return undefined;
		const dirty = run(['status', '--porcelain']).trim().length > 0;
		return dirty ? `${sha}+dirty` : sha;
	} catch {
		return undefined;
	}
}
