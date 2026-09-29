/** @format */

import * as fs from "fs";
import * as path from "path";
import logger, { flushLogs } from "../../src/core/logging/logger.service";

/**
 * L10 flush regression — found broken by live production testing 2026-09-29:
 * the SIGTERM sequence ran to completion (exit 0) but the shutdown tail never
 * reached disk, because the old flush ended the transport write queue while
 * the entries were still buffered in the rotate file's logStream.
 */
describe("flushLogs (L10)", () => {
  it("drains entries queued just before exit into the daily rotate file", async () => {
    const marker = `l10-flush-marker-${Date.now()}-${process.pid}`;
    logger.info(marker);

    await flushLogs(2000);

    const dir = path.join(process.cwd(), "logs");
    const candidates = fs
      .readdirSync(dir)
      .filter(f => /^app-.*\.log$/.test(f))
      .map(f => path.join(dir, f));
    const found = candidates.some(f => {
      try {
        return fs.readFileSync(f, "utf8").includes(marker);
      } catch {
        return false;
      }
    });
    expect(found).toBe(true);
  }, 10000);
});
