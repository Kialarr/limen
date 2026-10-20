import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import limenWake from "../hook/wake.ts";
import { registeredWakeJobs, registerWakeJob } from "../src/wake-origin.ts";

test("external subscribed jobs wake their originating session once, with checkout location", async (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "wake-origin-")));
	const previous = { ...process.env };
	t.after(() => {
		process.env = previous;
		rmSync(root, { recursive: true, force: true });
	});
	delete process.env.LIMEN_JOB;
	delete process.env.LIMEN_WAKE;
	process.env.LIMEN_HERDR = "0";
	process.env.LIMEN_HOME = root;
	process.env.LIMEN_WAKE_ORIGIN = "previous-origin";
	const local = join(root, "local");
	mkdirSync(join(local, ".agents/limen"), { recursive: true });
	const context = { cwd: local, isIdle: () => true, sessionManager: { getSessionId: () => "owner" }, ui: { notify() {}, setStatus() {} } };
	const handlers = new Map<
		string,
		(
			event: unknown,
			context: {
				cwd: string;
				isIdle(): boolean;
				sessionManager: { getSessionId(): string };
				ui: { notify(message: string, level: "info"): void; setStatus(key: string, value: string | undefined): void };
			},
		) => void
	>();
	const messages: string[] = [];
	limenWake({
		on(event, fn) {
			handlers.set(event, fn);
		},
		sendUserMessage(message) {
			messages.push(message);
		},
	});
	handlers.get("session_start")?.({}, context);
	t.after(() => handlers.get("session_shutdown")?.({}, context));
	const origin = JSON.parse(process.env.LIMEN_WAKE_ORIGIN!);
	const create = (checkout: string, subscriber: string) => {
		const job = join(root, checkout, ".limen/jobs/same-id");
		mkdirSync(join(job, "notify/subscribers"), { recursive: true });
		writeFileSync(join(job, "notify/subscribers", subscriber), "1");
		writeFileSync(join(job, "notify/ready"), "1");
		writeFileSync(join(job, "state"), "done");
		writeFileSync(join(job, "label"), checkout);
		return job;
	};
	const first = create("foreign-a", "owner");
	const second = create("foreign-b", "owner");
	const other = create("foreign-other", "other-session");
	registerWakeJob(first, "owner");
	registerWakeJob(second, "owner");
	registerWakeJob(other, "owner");
	const link = join(root, "alias");
	symlinkSync(first, link);
	registerWakeJob(link, "owner");
	assert.deepEqual(registeredWakeJobs(origin.directory, join(local, ".limen/jobs"), "owner").sort(), [first, second].sort());
	for (let count = 0; count < 40 && messages.length < 2; count++) await new Promise((r) => setTimeout(r, 50));
	assert.equal(messages.length, 2);
	assert(messages.some((message) => message.includes(first)));
	assert(messages.some((message) => message.includes(second)));
	for (const message of messages) {
		handlers.get("message_start")?.({ message: { role: "user", content: [{ type: "text", text: message }] } }, context);
	}
	handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "handled" }] } }, context);
	handlers.get("agent_settled")?.({}, context);
	await new Promise((r) => setTimeout(r, 650));
	assert.equal(messages.length, 2);
	assert.equal(readFileSync(join(first, "notify/delivered/owner/accepted"), "utf8"), "1\n");
	handlers.get("session_shutdown")?.({}, context);
	assert.equal(process.env.LIMEN_WAKE_ORIGIN, "previous-origin");
});

test("watch registers an existing foreign job and unwatch removes eligibility", async (t) => {
	const { watchCommand, unwatchCommand } = await import("../src/commands/watch.ts");
	const root = realpathSync(mkdtempSync(join(tmpdir(), "wake-watch-")));
	const previous = { ...process.env };
	t.after(() => {
		process.env = previous;
		rmSync(root, { recursive: true, force: true });
	});
	const local = join(root, "local/.limen/jobs");
	const foreign = join(root, "foreign");
	const job = join(foreign, ".limen/jobs/0123456789abcdef0123");
	mkdirSync(local, { recursive: true });
	mkdirSync(join(foreign, ".agents/limen"), { recursive: true });
	mkdirSync(job, { recursive: true });
	writeFileSync(join(job, "state"), "running");
	const directory = join(root, "registry");
	process.env.PI_SESSION_ID = "owner";
	process.env.LIMEN_WAKE_ORIGIN = JSON.stringify({ directory, session: "owner" });
	registerWakeJob(job, "other");
	assert.deepEqual(registeredWakeJobs(directory, local, "owner"), []);
	await watchCommand(["0123456789abcdef0123"], foreign);
	assert.deepEqual(registeredWakeJobs(directory, local, "owner"), [job]);
	await unwatchCommand(["0123456789abcdef0123"], foreign);
	assert.deepEqual(registeredWakeJobs(directory, local, "owner"), []);
	assert.deepEqual(registeredWakeJobs(directory, join(root, "removed"), "owner"), []);
});
