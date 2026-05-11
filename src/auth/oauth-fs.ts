/**
 * Internal: filesystem helpers for the auth module.
 *
 * The wizard already has an `atomicWrite` in `commands/init/shared.ts`, but
 * importing wizard internals from non-wizard code creates a cycle (the
 * wizard depends on `auth/`, and `auth/` would depend back on the wizard).
 * Duplicating the helpers here keeps the dependency graph clean.
 *
 * `atomicWrite` matches `commands/init/shared.ts#atomicWrite`: write to a
 * sibling tmp file then `rename`. On POSIX same-filesystem, rename is
 * atomic. The tmp suffix uses crypto-random bytes so concurrent writers
 * don't collide.
 *
 * `withFileLock` serialises a critical section using a sidecar `<path>.lock`
 * file created with `O_EXCL`. Used by the OAuth refresh path so two
 * concurrent CLI invocations can't both consume the same refresh token,
 * which would invalidate it on Linear's side and brick the user's auth.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";

export async function atomicWrite(
	targetPath: string,
	data: string | Uint8Array,
	mode = 0o644,
): Promise<void> {
	const tmpPath = `${targetPath}.tmp-${randomBytes(8).toString("hex")}`;
	try {
		await fs.writeFile(tmpPath, data, { encoding: "utf8", mode });
		// fs.writeFile only honors `mode` when the file is newly created.
		// Tmp paths are always new, but be explicit to make this airtight if
		// the random suffix ever collides with a stale tmp.
		await fs.chmod(tmpPath, mode);
		await fs.rename(tmpPath, targetPath);
	} catch (err) {
		await fs.unlink(tmpPath).catch(() => {});
		throw err;
	}
}

interface FileLockOptions {
	/** Treat a lock older than this as crashed and steal it. Default 30s. */
	staleAfterMs?: number;
	/** Maximum time to wait for the lock before giving up. Default 30s. */
	maxWaitMs?: number;
	/** Poll interval while waiting. Default 100ms. */
	pollMs?: number;
}

/**
 * Run `fn` while holding an exclusive file lock at `<targetPath>.lock`.
 *
 * Implementation: `fs.open(..., "wx")` is the POSIX `O_EXCL` create — it
 * fails atomically if the lockfile already exists. On success we own the
 * lock; we delete the file in `finally` so a synchronous throw still
 * releases. A crashed process leaves the lockfile behind; the next caller
 * detects staleness via `mtime` and steals the lock.
 *
 * Limitations: this is a single-machine lock. NFS-style multi-machine
 * coordination is out of scope (and the OAuth state is per-machine
 * anyway).
 */
export async function withFileLock<T>(
	targetPath: string,
	fn: () => Promise<T>,
	options: FileLockOptions = {},
): Promise<T> {
	const staleAfterMs = options.staleAfterMs ?? 30_000;
	const maxWaitMs = options.maxWaitMs ?? 30_000;
	const pollMs = options.pollMs ?? 100;
	const lockPath = `${targetPath}.lock`;
	const start = Date.now();
	while (true) {
		try {
			const handle = await fs.open(lockPath, "wx");
			try {
				await handle.writeFile(`${process.pid}\n${Date.now()}\n`);
			} finally {
				await handle.close();
			}
			try {
				return await fn();
			} finally {
				await fs.unlink(lockPath).catch(() => {});
			}
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") throw err;
			// Lockfile already exists. Check whether it's stale (process died
			// before releasing) and either steal it or wait.
			let stolen = false;
			try {
				const stat = await fs.stat(lockPath);
				if (Date.now() - stat.mtimeMs > staleAfterMs) {
					await fs.unlink(lockPath).catch(() => {});
					stolen = true;
				}
			} catch {
				// Lockfile was removed between the EEXIST and the stat. Race
				// with the holder's normal release path — just retry.
				stolen = true;
			}
			if (stolen) continue;
			if (Date.now() - start > maxWaitMs) {
				throw new Error(
					`Timed out after ${maxWaitMs}ms waiting for ${lockPath}. ` +
						`Another el-linear process is holding the lock; if none is running, ` +
						`delete the file manually and retry.`,
				);
			}
			await new Promise((r) => setTimeout(r, pollMs));
		}
	}
}
