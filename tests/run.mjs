/**
 * Test runner.
 *
 * The suites import the plugin's own modules, so they run against the real
 * implementation rather than a copy. `obsidian` is swapped for a stub,
 * because the modules under test only use it for `normalizePath`.
 *
 *   npm test               run the unit suites
 *   npm run test:vault     also scan a real vault (set VAULT=/path/to/vault)
 */

import esbuild from "esbuild";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(here, "obsidian-stub.js");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "hptp-tests-"));

const suites = process.argv.slice(2);
if (suites.length === 0) suites.push("format.test.ts", "data.test.ts");

let failed = 0;

for (const suite of suites) {
	const entry = path.join(here, suite);
	if (!fs.existsSync(entry)) {
		console.error(`No such suite: ${suite}`);
		failed++;
		continue;
	}

	const outfile = path.join(outDir, `${path.basename(suite, ".ts")}.cjs`);

	try {
		await esbuild.build({
			entryPoints: [entry],
			bundle: true,
			platform: "node",
			format: "cjs",
			outfile,
			alias: { obsidian: stub },
			logLevel: "error",
		});
	} catch {
		failed++;
		continue;
	}

	console.log(`\n── ${suite} ${"─".repeat(Math.max(0, 50 - suite.length))}`);
	const run = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
	if (run.status !== 0) failed++;
}

fs.rmSync(outDir, { recursive: true, force: true });

if (failed > 0) {
	console.error(`\n${failed} suite(s) failed.\n`);
	process.exit(1);
}
console.log("\nAll suites passed.\n");
