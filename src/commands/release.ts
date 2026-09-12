import { releaseClaims } from "../claims.ts";
import { resolveJob } from "../lookup.ts";

export async function releaseCommand(args: readonly string[], cwd: string): Promise<void> {
	if (args.length !== 1 || !args[0]) throw new Error("release requires <id|suffix|label>");
	const { id, jobDir } = await resolveJob(cwd, args[0]);
	await releaseClaims(jobDir);
	console.log(`released claims for ${id}; runtime completion is not product acceptance`);
}
