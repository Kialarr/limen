import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireClaims, captureCandidate, releaseClaims } from "../src/claims.ts";
import { pruneFinishedWorktrees } from "../src/commands/prune.ts";

function git(root: string, ...args: string[]): string {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "limen-claims-test-"));
	const before = process.env.LIMEN_CLAIMS_DIR;
	process.env.LIMEN_CLAIMS_DIR = join(root, "claims");
	const job = async (name: string) => {
		const path = join(root, name);
		await mkdir(path);
		return path;
	};
	return {
		root,
		job,
		async close() {
			if (before === undefined) delete process.env.LIMEN_CLAIMS_DIR;
			else process.env.LIMEN_CLAIMS_DIR = before;
			await rm(root, { recursive: true, force: true });
		},
	};
}

test("checkout ownership excludes another reviewer and resources contend across checkouts", async () => {
	const f = await fixture();
	try {
		const first = await f.job("first"),
			second = await f.job("second");
		await acquireClaims(first, ["unity-editor"], f.root);
		await assert.rejects(acquireClaims(second, [], f.root), /claim held or uncertain/);
		await assert.rejects(acquireClaims(second, ["unity-editor"], second), /claim held or uncertain/);
		assert.equal((await readdir(join(f.root, "claims"))).length, 2, "partial checkout acquisition rolls back");
		await assert.rejects(releaseClaims(first));
		await writeFile(join(first, "state"), "done\n");
		await writeFile(join(first, "claim-pid"), String(process.pid));
		await assert.rejects(releaseClaims(first), /settlement/);
		await assert.rejects(acquireClaims(second, ["unity-editor"]), /claim held/);
	} finally {
		await f.close();
	}
});

test("explicit release accepts a settled process but refuses uncertain cleanup", async () => {
	const f = await fixture();
	try {
		const first = await f.job("first"),
			second = await f.job("second");
		await acquireClaims(first, ["editor"]);
		const child = spawnSync(process.execPath, ["-e", ""]);
		assert.equal(child.status, 0);
		await writeFile(join(first, "state"), "failed\n");
		await writeFile(join(first, "claim-pid"), String(child.pid));
		await writeFile(join(first, "cleanup"), "uncertain child");
		await assert.rejects(releaseClaims(first), /uncertain/);
		await rm(join(first, "cleanup"));
		await releaseClaims(first);
		await acquireClaims(second, ["editor"]);
		await assert.rejects(releaseClaims(first));
		await assert.rejects(acquireClaims(first, ["editor"]), /claim held/);
	} finally {
		await f.close();
	}
});

test("failed setup can release explicitly; missing ownership fails closed", async () => {
	const f = await fixture();
	try {
		const job = await f.job("job");
		await acquireClaims(job, ["editor"]);
		await writeFile(join(job, "state"), "failed\n");
		await writeFile(join(job, "launch-not-started"), "1\n");
		const locks = await readdir(join(f.root, "claims"));
		const owner = join(f.root, "claims", locks[0] ?? "", "owner.json");
		const saved = await readFile(owner);
		await rm(owner);
		await assert.rejects(releaseClaims(job));
		await assert.rejects(acquireClaims(await f.job("other"), ["editor"]), /uncertain/);
		await writeFile(owner, saved);
		await releaseClaims(job);
		assert.equal((await readdir(join(f.root, "claims"))).length, 0);
	} finally {
		await f.close();
	}
});

test("dirty candidate preserves index, HEAD, untracked binary and deletions", async () => {
	const f = await fixture();
	try {
		const repo = await f.job("repo"),
			job = await f.job("job");
		git(repo, "init", "-q");
		git(repo, "config", "user.email", "fixture@example.invalid");
		git(repo, "config", "user.name", "Fixture");
		await writeFile(join(repo, "file"), "original\n");
		await writeFile(join(repo, "deleted"), "remove me\n");
		await writeFile(join(repo, ".gitignore"), "ignored\n");
		git(repo, "add", ".");
		git(repo, "commit", "-qm", "initial");
		await writeFile(join(repo, "file"), "staged\n");
		git(repo, "add", "file");
		await writeFile(join(repo, "file"), "unstaged\n");
		await writeFile(join(repo, "binary"), Buffer.from([0, 1, 255]));
		await writeFile(join(repo, "ignored"), "outside candidate\n");
		await rm(join(repo, "deleted"));
		git(repo, "add", "deleted");
		const index = await readFile(join(repo, ".git", "index")),
			head = git(repo, "rev-parse", "HEAD");
		const tree = await captureCandidate(repo, job);
		assert.equal(git(repo, "show", `${tree}:file`), "unstaged\n");
		assert.equal(git(repo, "ls-tree", "--name-only", tree).includes("deleted"), false);
		assert.equal(git(repo, "ls-tree", "--name-only", tree).includes("ignored"), false);
		const binary = spawnSync("git", ["show", `${tree}:binary`], { cwd: repo }).stdout;
		assert.deepEqual(binary, Buffer.from([0, 1, 255]));
		assert.deepEqual(await readFile(join(repo, ".git", "index")), index);
		assert.equal(git(repo, "rev-parse", "HEAD"), head);
		assert.match(await readFile(join(job, "candidate-index.patch"), "utf8"), /\+staged/);
		assert.match(await readFile(join(job, "candidate.patch"), "utf8"), /GIT binary patch/);
	} finally {
		await f.close();
	}
});

test("prune never removes an existing checkout inside Limen's managed worktree directory", async () => {
	const f = await fixture();
	try {
		const repo = await f.job("repo");
		git(repo, "init", "-q");
		git(repo, "config", "user.email", "fixture@example.invalid");
		git(repo, "config", "user.name", "Fixture");
		await writeFile(join(repo, "file"), "base");
		git(repo, "add", ".");
		git(repo, "commit", "-qm", "initial");
		const checkout = join(f.root, ".repo-limen-worktrees", "existing");
		git(repo, "worktree", "add", "-b", "existing", checkout);
		const job = join(repo, ".limen", "jobs", "job");
		await mkdir(job, { recursive: true });
		await writeFile(join(job, "workspace"), "existing\n");
		await writeFile(join(job, "worktree"), `${checkout}\n`);
		await writeFile(join(job, "state"), "done\n");
		assert.equal(await pruneFinishedWorktrees(repo), 0);
		assert.equal(await readFile(join(checkout, "file"), "utf8"), "base");
		await rm(join(job, "state"));
		assert.equal(await pruneFinishedWorktrees(repo), 0);
	} finally {
		await f.close();
	}
});

test("existing checkout spawn keeps dirty work, captures review and requires explicit release", async (context) => {
	const { scratchRepo, limenWithEnv, onlyJobId, waitForState } = await import("./scratch.ts");
	const scratch = await scratchRepo('#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"reviewed"}]}}));\n');
	context.after(scratch.cleanup);
	const run = (...args: string[]) => limenWithEnv(scratch, { LIMEN_CLAIMS_DIR: join(scratch.fakeBin, "claims") }, ...args);
	assert.equal(run("init").status, 0);
	await writeFile(join(scratch.root, "dirty.txt"), "review this dirty candidate\n");
	const branch = git(scratch.root, "symbolic-ref", "--short", "HEAD"),
		head = git(scratch.root, "rev-parse", "HEAD");
	const launched = run("spawn", "--workspace", "existing", "--review", "--claim", "editor", "--detached", "inspect candidate");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout),
		job = join(scratch.root, ".limen/jobs", id);
	await waitForState(scratch.root, id, "done");
	assert.equal(git(scratch.root, "symbolic-ref", "--short", "HEAD"), branch);
	assert.equal(git(scratch.root, "rev-parse", "HEAD"), head);
	assert.equal(await readFile(join(scratch.root, "dirty.txt"), "utf8"), "review this dirty candidate\n");
	assert.match(await readFile(join(job, "candidate.patch"), "utf8"), /review this dirty candidate/);
	assert.match(run("diff", id).stdout, /dirty candidate patch: .*candidate.patch/);
	assert.match(run("spawn", "--workspace", "existing", "--detached", "compete").stderr, /claim held/);
	assert.match(run("continue", id, "again").stderr, /fresh spawn/);
	assert.equal(run("prune").status, 0);
	assert.equal(await readFile(join(scratch.root, "dirty.txt"), "utf8"), "review this dirty candidate\n");
	// Terminal publication precedes wrapper exit. Poll only for this explicit verification, with a bounded deadline.
	const deadline = Date.now() + 5000;
	let released = run("release", id);
	while (released.status !== 0 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 25));
		released = run("release", id);
	}
	assert.equal(released.status, 0, released.stderr);
	const fresh = run("spawn", "--workspace", "existing", "--detached", "fresh assignment");
	assert.equal(fresh.status, 0, fresh.stderr);
	await waitForState(scratch.root, onlyJobId(fresh.stdout), "done");
});
