import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { limen, limenWithEnv, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const streamingPi = `#!/usr/bin/env node
const events = [{ type: "agent_start" }];
for (let n = 0; n < 4000; n++) {
  events.push({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } });
  if (n === 500 || n === 1500 || n === 2500) {
    events.push({ type: "tool_execution_start", toolName: "read", args: { path: "file-" + n } });
    events.push({ type: "tool_execution_end", toolName: "read" });
  }
}
require("node:fs").writeFileSync("stream-result.txt", "completed");
events.push({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "stream finished" }], stopReason: "stop" } });
process.stdout.write(events.map(event => JSON.stringify(event)).join("\\n") + "\\n");
`;

for (const oversized of [false, true])
	test(`a large streamed answer settles ${oversized ? "when Git status exceeds its output buffer" : "without a Git scan for every activity event"}`, async (context) => {
		const scratch = await scratchRepo(streamingPi);
		let id: string | undefined;
		const gitEnvironment: NodeJS.ProcessEnv = {};
		context.after(async () => {
			if (id && (await readFile(join(scratch.root, ".limen/jobs", id, "state"), "utf8").catch(() => "")).trim() === "running") {
				limenWithEnv(scratch, gitEnvironment, "stop", id, "regression fixture cleanup");
			}
			await scratch.cleanup();
		});
		assert.equal(limen(scratch, "init").status, 0);
		const git = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
		const scans = join(scratch.fakeBin, "status-scans");
		await writeFile(scans, "");
		// Simulate repository scan cost without needing a large Unity checkout. The
		// scanner count is the primary assertion; the deadline catches finalization backlog.
		await writeFile(
			join(scratch.fakeBin, "git"),
			`#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = status ]; then
    printf 'scan\\n' >> "$LIMEN_TEST_STATUS_SCANS"
    sleep 0.01
    if [ "$LIMEN_INTERNAL_RUN" = 1 ] && [ "$LIMEN_TEST_OVERSIZED_STATUS" = 1 ]; then
      exec "$LIMEN_TEST_NODE" -e 'process.stdout.write("?".repeat(2 * 1024 * 1024))'
    fi
    break
  fi
done
exec "$LIMEN_TEST_REAL_GIT" "$@"
`,
		);
		await chmod(join(scratch.fakeBin, "git"), 0o755);
		Object.assign(gitEnvironment, {
			LIMEN_TEST_STATUS_SCANS: scans,
			LIMEN_TEST_REAL_GIT: git,
			LIMEN_TEST_NODE: process.execPath,
			LIMEN_TEST_OVERSIZED_STATUS: oversized ? "1" : "0",
		});
		const launched = limenWithEnv(scratch, gitEnvironment, "spawn", "--detached", "stream a focused answer");
		assert.equal(launched.status, 0, launched.stderr);
		id = onlyJobId(launched.stdout);
		await waitForState(scratch.root, id, "done", 5_000);
		const job = join(scratch.root, ".limen/jobs", id);
		assert.equal(await readFile(join(job, "result"), "utf8"), "stream finished\n");
		assert.equal(await readFile(join(job, "tool-calls"), "utf8"), "3\n");
		if (oversized) await assert.rejects(readFile(join(job, "changed-files")), { code: "ENOENT" });
		else assert.equal(await readFile(join(job, "changed-files"), "utf8"), "1\n");
		const log = await readFile(join(job, "log"), "utf8");
		if (oversized) assert.match(log, /changed-file scan failed:.*ENOBUFS/);
		for (const n of [500, 1500, 2500]) assert.match(log, new RegExp(`read file-${n}`));
		assert.equal((log.match(/\] done:/g) ?? []).length, 1);
		const scanCount = (await readFile(scans, "utf8")).trim().split("\n").filter(Boolean).length;
		context.diagnostic(`4,000 stream updates: ${scanCount} Git scans, all 3 tools and final result retained`);
		assert.ok(scanCount > 0, "the fake Git executable must observe scans");
		assert.ok(scanCount < 25, `4,000 stream updates caused ${scanCount} Git scans`);
	});
