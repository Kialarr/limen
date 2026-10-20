import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

/** A coordinator passes this address to its CLI children, even after they change checkout. */
export function registerWakeJob(job: string, session: string | undefined): void {
	const raw = process.env.LIMEN_WAKE_ORIGIN;
	if (!raw || !session) return;
	const origin = JSON.parse(raw) as { directory?: string; session?: string };
	if (origin.session !== session) return;
	if (!origin.directory || !isAbsolute(origin.directory)) throw new Error("Invalid Limen wake origin");
	const canonical = realpathSync(job);
	mkdirSync(origin.directory, { recursive: true });
	const key = createHash("sha256").update(canonical).digest("hex");
	writeFileSync(join(origin.directory, key), `${canonical}\n`);
}

export function registeredWakeJobs(directory: string, localJobs: string, session: string): string[] {
	if (!existsSync(directory)) return [];
	let local: string;
	let keys: string[];
	try {
		local = realpathSync(localJobs);
		keys = readdirSync(directory);
	} catch {
		return [];
	}
	const jobs = new Set<string>();
	for (const key of keys) {
		if (!/^[a-f0-9]{64}$/.test(key)) continue;
		try {
			const path = readFileSync(join(directory, key), "utf8").trim();
			if (!isAbsolute(path)) continue;
			const job = realpathSync(path);
			if (dirname(job) !== local && existsSync(join(job, "notify/subscribers", session))) jobs.add(job);
		} catch {
			// Removed jobs and incomplete registrations are retried by the next sweep.
		}
	}
	return [...jobs];
}
