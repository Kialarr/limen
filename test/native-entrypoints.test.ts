import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const bin = join(packageRoot, "bin/limen");
const node22 = "/Users/kjalarr/.nvm/versions/node/v22.22.2/bin/node";
const node23 = "/opt/homebrew/bin/node";

for (const oldNode of [node22, node23]) {
	test(`native limen bootstraps ${oldNode} into configured Node24`, { skip: !existsSync(oldNode) }, () => {
		const result = spawnSync(oldNode, [bin, "--help"], {
			encoding: "utf8",
			timeout: 10000,
			env: { ...process.env, RKX_NODE: process.execPath, LIMEN_NODE_REEXEC: "" },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /limen — isolated coding jobs/);
	});
}

test("old runtime rejects missing, invalid and recursively incompatible configured runtimes", { skip: !existsSync(node22) }, () => {
	for (const runtime of ["", "/missing/limen-node", node22]) {
		const result = spawnSync(node22, [bin, "--help"], {
			encoding: "utf8",
			timeout: 10000,
			env: { ...process.env, RKX_NODE: runtime, LIMEN_NODE_REEXEC: "" },
		});
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /RKX_NODE/);
		assert.equal(result.error, undefined, "incompatible runtime stops after one reexecution");
	}
});

test("Node24 follows upstream entrypoint without consulting RKX_NODE", () => {
	const result = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8", env: { ...process.env, RKX_NODE: "/missing/limen-node" } });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /limen — isolated coding jobs/);
});

test("project Pi stub resolves PATH package, registers hooks and defaults inherited shop environment", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "limen-stub-test-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const installed = join(root, "installed"),
		pathBin = join(root, "path-bin"),
		stub = join(root, "limen.ts");
	await mkdir(join(installed, "hook"), { recursive: true });
	await mkdir(join(installed, "bin"));
	await mkdir(pathBin);
	await writeFile(join(root, "package.json"), '{"type":"module"}');
	await writeFile(join(installed, "bin/limen"), "fixture");
	await symlink(join(installed, "bin/limen"), join(pathBin, "limen"));
	await copyFile(join(packageRoot, "templates/limen-extension.ts"), stub);
	for (const name of ["wake", "communication", "steering"]) await writeFile(join(installed, "hook", `${name}.ts`), `export default function(pi) { pi.on("${name}", () => {}); }`);
	const source = `const {default: stub} = await import(${JSON.stringify(pathToFileURL(stub).href)}); const hooks=[]; await stub({on: name=>hooks.push(name)}); console.log(JSON.stringify({hooks, root:process.env.LIMEN_PACKAGE, shop:process.env.LIMEN_INHERIT_SHOP, path:process.env.PATH}));`;
	for (const explicit of [false, true]) {
		const environment: NodeJS.ProcessEnv = { ...process.env, PATH: pathBin, RKX_NODE: process.execPath };
		delete environment.LIMEN_PACKAGE;
		delete environment.LIMEN_INHERIT_SHOP;
		if (explicit) Object.assign(environment, { LIMEN_PACKAGE: installed, LIMEN_INHERIT_SHOP: "0" });
		const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", env: environment });
		assert.equal(result.status, 0, result.stderr);
		const loaded = JSON.parse(result.stdout);
		assert.deepEqual(loaded.hooks, ["wake", "communication", "steering"]);
		assert.equal(await realpath(loaded.root), await realpath(installed));
		assert.equal(loaded.shop, explicit ? "0" : "1");
		assert.deepEqual(loaded.path.split(":").slice(0, 2), [join(loaded.root, "bin"), dirname(await realpath(process.execPath))]);
	}
	const rejected = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
		encoding: "utf8",
		env: { ...process.env, LIMEN_PACKAGE: installed, RKX_NODE: "/missing/limen-node" },
	});
	assert.notEqual(rejected.status, 0);
	assert.match(rejected.stderr, /RKX_NODE must run Node.js 24/);
});

test("Node22 bootstrap preserves literal args, stdin, stderr and exit status", { skip: !existsSync(node22) }, async (context) => {
	const root = await mkdtemp(join(tmpdir(), "limen-bootstrap-test-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "bin"));
	await mkdir(join(root, "src"));
	await writeFile(join(root, "package.json"), '{"type":"module"}');
	await copyFile(bin, join(root, "bin/limen"));
	await writeFile(
		join(root, "src/main.ts"),
		'import {readFileSync} from "node:fs"; export async function main(args: string[]) { console.log(JSON.stringify({args,input:readFileSync(0,"utf8"),node:process.versions.node})); console.error("fixture stderr"); process.exitCode=7; }',
	);
	const result = spawnSync(node22, [join(root, "bin/limen"), "space argument", "$(literal)", "--flag"], {
		encoding: "utf8",
		input: "stdin bytes\n",
		env: { ...process.env, RKX_NODE: process.execPath, LIMEN_NODE_REEXEC: "" },
	});
	assert.equal(result.status, 7);
	assert.equal(result.stderr.trim(), "fixture stderr");
	assert.deepEqual(JSON.parse(result.stdout), { args: ["space argument", "$(literal)", "--flag"], input: "stdin bytes\n", node: process.versions.node });
});
