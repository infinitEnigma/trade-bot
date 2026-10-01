/**
 * Durable file writes.
 *
 * A plain `writeFile` can leave a half-written file behind if the process dies
 * mid-write — and a strategy then trusts that torn file. Writing the payload to
 * a temp file, fsyncing it, then atomically renaming over the target means a
 * reader sees either the old complete file or the new complete file, never a
 * partial one. The containing directory is fsynced too, so the rename itself
 * survives a crash. The previous version is kept alongside as `<file>.prev`, so
 * a checksum failure still has a known-good fallback to recover from.
 *
 * This is the same rename + fsync discipline an embedded database uses
 * internally; here it is ~30 lines because the payload is a single small,
 * single-writer file (see PROJECT_REVIEW_GAP_ANALYSIS.md §4 Phase 3).
 *
 * @format
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Atomically and durably replace `<dir>/<file>` with `contents`.
 *
 * Throws on failure; callers that must never throw into a trading tick (the
 * grid snapshot writer) catch and log instead.
 */
export function durableWriteSync(
  dir: string,
  file: string,
  contents: string
): void {
  fs.mkdirSync(dir, { recursive: true });

  const target = path.join(dir, file);
  const tmp = path.join(dir, `.${file}.${process.pid}.${Date.now()}.tmp`);

  // 1. Write the payload to a temp file and flush it to disk.
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    // 2. Keep the current file as the fallback before replacing it.
    if (fs.existsSync(target)) {
      try {
        fs.copyFileSync(target, `${target}.prev`);
      } catch {
        // Best-effort: the previous snapshot is a convenience, not a contract.
      }
    }

    // 3. Atomic replace — a reader never observes a torn file.
    fs.renameSync(tmp, target);

    // 4. Flush the directory entry so the rename is durable.
    syncDir(dir);
  } catch (error) {
    // Never leave a stray temp file behind on failure.
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore — the temp file may already be gone
    }
    throw error;
  }
}

/** fsync a directory so a rename within it is durable (best-effort). */
function syncDir(dir: string): void {
  let dfd: number | undefined;
  try {
    dfd = fs.openSync(dir, "r");
    fs.fsyncSync(dfd);
  } catch {
    // Some platforms/filesystems do not permit directory fsync — tolerate it.
  } finally {
    if (dfd !== undefined) {
      try {
        fs.closeSync(dfd);
      } catch {
        // ignore
      }
    }
  }
}
