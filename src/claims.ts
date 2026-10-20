import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { processAlive, processGroupAlive } from "./contain.ts";

type Claim = { key: string; path: string; owner: string };
const registry = () => process.env.LIMEN_CLAIMS_DIR || join(homedir(), ".limen", "claims");

// Directory creation is the exclusive operation. Never infer release from age, job state or a missing owner.
export async function acquireClaims(jobDir: string, resources: readonly string[], checkout?: string): Promise<void> {
	const owner = await realpath(jobDir);
	const keys = resources.map((resource) => {
		if (!resource.trim() || resource !== resource.trim() || /[\r\n\0]/.test(resource)) throw new Error("--claim requires a non-empty resource key without surrounding whitespace");
		return `resource:${resource}`;
	});
	if (checkout) keys.push(`checkout:${await realpath(checkout)}`);
	if (!keys.length) return;
	await mkdir(registry(), { recursive: true, mode: 0o700 });
	const acquired: Claim[] = [];
	try {
		for (const key of [...new Set(keys)].sort()) {
			const path = join(registry(), createHash("sha256").update(key).digest("hex"));
			try {
				await mkdir(path, { mode: 0o700 });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`claim held or uncertain: ${key}; inspect its owner and explicitly release the settled job`);
				throw error;
			}
			acquired.push({ key, path, owner });
			await writeFile(join(path, "owner.json"), JSON.stringify({ key, owner }), { flag: "wx", flush: true });
		}
		await writeFile(join(jobDir, "claims.json"), JSON.stringify(acquired), { flag: "wx", flush: true });
	} catch (error) {
		// Only roll back locks created by this invocation, before any worker is launched.
		for (const claim of acquired) await rm(claim.path, { recursive: true });
		throw error;
	}
}

export async function releaseClaims(jobDir: string): Promise<void> {
	const state = (await readFile(join(jobDir, "state"), "utf8")).trim();
	if (!["done", "failed", "stopped"].includes(state)) throw new Error("release requires a terminal job");
	if (existsSync(join(jobDir, "hosted")) || existsSync(join(jobDir, "cleanup"))) throw new Error("release blocked: hosted or uncertain process cleanup requires investigation");
	if (!existsSync(join(jobDir, "launch-not-started"))) {
		const pid = Number(await readFile(join(jobDir, "claim-pid"), "utf8"));
		if (!Number.isSafeInteger(pid) || pid <= 0 || processAlive(pid) || processGroupAlive(pid)) throw new Error("release blocked: process settlement is unverified");
	}
	const claims: Claim[] = JSON.parse(await readFile(join(jobDir, "claims.json"), "utf8"));
	const owner = await realpath(jobDir);
	// Serialize explicit releases too: a second releaser must not remove a newly acquired claim.
	const releasing = join(jobDir, "releasing-claims");
	await mkdir(releasing);
	try {
		for (const claim of claims) {
			const held = JSON.parse(await readFile(join(claim.path, "owner.json"), "utf8"));
			if (claim.owner !== owner || held.owner !== owner || held.key !== claim.key) throw new Error("claim ownership changed; release refused");
		}
		for (const claim of claims) await rm(claim.path, { recursive: true });
		await writeFile(join(jobDir, "claims-released"), `${new Date().toISOString()}\n`, { flag: "wx", flush: true });
	} finally {
		await rm(releasing, { recursive: true });
	}
}

function git(root: string, args: string[], index?: string, input?: Buffer, timeout?: number): Buffer {
	const result = spawnSync("git", args, {
		cwd: root,
		env: { ...process.env, ...(index ? { GIT_INDEX_FILE: index } : {}) },
		maxBuffer: 64 * 1024 * 1024,
		...(timeout ? { timeout, killSignal: "SIGKILL" as const } : {}),
		...(input ? { input } : {}),
	});
	if (result.status !== 0) throw new Error(`candidate git ${args[0]} failed: ${result.error?.message || result.stderr?.toString().trim()}`);
	return result.stdout;
}
export function currentBranch(root: string): string {
	return git(root, ["symbolic-ref", "--short", "HEAD"]).toString().trim();
}

// A Git tree retains binary, deleted and untracked candidate files without modifying HEAD or the user's index.
// Ignored files are deliberately outside a Git review candidate. Two reads detect concurrent ordinary writes.
export async function captureCandidate(root: string, jobDir: string): Promise<string> {
	const budget = Number(process.env.LIMEN_CAPTURE_TIMEOUT_MS ?? 180_000);
	if (!Number.isFinite(budget) || budget <= 0) throw new Error("LIMEN_CAPTURE_TIMEOUT_MS must be positive");
	const deadline = Date.now() + budget;
	const candidateGit = (root: string, args: string[], index?: string) => {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("candidate capture timed out");
		return git(root, args, index, undefined, Math.max(1, Math.ceil(remaining)));
	};
	const temporary = await mkdtemp(join(tmpdir(), "limen-candidate-"));
	try {
		const index = join(temporary, "index");
		const head = candidateGit(root, ["rev-parse", "HEAD"]).toString().trim();
		const staged = candidateGit(root, ["diff", "--cached", "--binary", "--no-ext-diff", "HEAD"]);
		const snapshot = () => {
			candidateGit(root, ["read-tree", "HEAD"], index);
			// A directory pathspec lets Git handle ignored files and tracked deletions.
			// Enumerating HEAD paths instead can explicitly select now-ignored paths.
			candidateGit(root, ["add", "-A", "--", "."], index);
			// Restore runtime paths only in the disposable index. An explicit negative
			// add pathspec still makes Git reject ignored .limen directories.
			candidateGit(root, ["reset", "-q", "HEAD", "--", ".limen"], index);
			return candidateGit(root, ["write-tree"], index).toString().trim();
		};
		const tree = snapshot();
		if (
			tree !== snapshot() ||
			!staged.equals(candidateGit(root, ["diff", "--cached", "--binary", "--no-ext-diff", "HEAD"])) ||
			head !== candidateGit(root, ["rev-parse", "HEAD"]).toString().trim()
		)
			throw new Error("candidate changed during capture; stop external writers before review");
		await writeFile(join(jobDir, "candidate-index.patch"), staged, { flag: "wx", flush: true });
		await writeFile(join(jobDir, "candidate.patch"), candidateGit(root, ["diff", "--binary", "--no-ext-diff", head, tree]), { flag: "wx", flush: true });
		await writeFile(
			join(jobDir, "candidate.json"),
			JSON.stringify({ head, tree, scope: "Git tracked and non-ignored untracked files; .limen excluded", stagedPatch: "candidate-index.patch" }),
			{ flag: "wx", flush: true },
		);
		return tree;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
