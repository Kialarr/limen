import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Project stub: load wake, speech, and steering from the installed limen package. */
export default async function limen(pi: unknown): Promise<void> {
	const root = resolve(process.env.LIMEN_PACKAGE?.trim() || findPackage());
	const configuredNode = process.env.RKX_NODE?.trim();
	let nodeDirectory: string | undefined;
	if (configuredNode) {
		const probe = spawnSync(configuredNode, ["-p", "process.versions.node"], { encoding: "utf8", timeout: 5000 });
		if (probe.status !== 0 || !(Number.parseInt(probe.stdout.trim(), 10) >= 24))
			throw new Error(`RKX_NODE must run Node.js 24 or newer: ${probe.error?.message || probe.stderr.trim() || probe.stdout.trim()}`);
		nodeDirectory = dirname(realpathSync(configuredNode));
	} else if (Number.parseInt(process.versions.node, 10) < 24) {
		throw new Error("limen requires Node.js 24 or newer; set RKX_NODE to a compatible Node executable");
	} else nodeDirectory = dirname(process.execPath);
	process.env.LIMEN_PACKAGE = resolve(root);
	process.env.LIMEN_INHERIT_SHOP ??= "1";
	process.env.PATH = [...new Set([join(root, "bin"), nodeDirectory, ...(process.env.PATH ?? "").split(delimiter)].filter(Boolean))].join(delimiter);
	for (const name of ["wake", "communication", "steering"]) {
		const loaded = await import(pathToFileURL(join(root, "hook", `${name}.ts`)).href);
		await loaded.default(pi);
	}
}

function findPackage(): string {
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (!dir) continue;
		const bin = join(dir, "limen");
		if (!existsSync(bin)) continue;
		return join(dirname(realpathSync(bin)), "..");
	}
	throw new Error("limen is not on PATH; cannot load package hooks");
}
