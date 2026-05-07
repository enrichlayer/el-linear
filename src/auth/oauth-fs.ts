/**
 * Internal: atomic write helper used by `oauth-storage.ts`.
 *
 * The wizard already has an `atomicWrite` in `commands/init/shared.ts`, but
 * importing wizard internals from non-wizard code creates a cycle (the
 * wizard depends on `auth/`, and `auth/` would depend back on the wizard).
 * Duplicating the 12-line helper here keeps the dependency graph clean.
 *
 * Behaviour matches `commands/init/shared.ts#atomicWrite`: write to a sibling
 * tmp file then `rename`. On POSIX same-filesystem, rename is atomic. The
 * tmp suffix uses crypto-random bytes so concurrent writers don't collide.
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
		// fs.writeFile only honours `mode` when the file is newly created.
		// Tmp paths are always new, but be explicit to make this airtight if
		// the random suffix ever collides with a stale tmp.
		await fs.chmod(tmpPath, mode);
		await fs.rename(tmpPath, targetPath);
	} catch (err) {
		await fs.unlink(tmpPath).catch(() => {});
		throw err;
	}
}
