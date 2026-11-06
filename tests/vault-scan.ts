import { parseTaskLine, isTaskLine, serialiseTask, displayText } from "../src/taskFormat";
import { isExcludedBy } from "../src/taskStore";
import type { Task } from "../src/types";
import * as fs from "fs";
import * as path from "path";

const VAULT = process.env.VAULT ?? "";
if (!VAULT) {
  console.error("Set VAULT to a vault path, e.g. VAULT=\"/path/to/vault\" npm run test:vault");
  process.exit(1);
}
const EXCLUDE = ["Templates", ".trash", "Archive"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const all: Task[] = [];
const inScope: Task[] = [];
let skippedFence = 0;
const roundTripFailures: string[] = [];

for (const file of walk(VAULT)) {
  const rel = path.relative(VAULT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { if (isTaskLine(line)) skippedFence++; continue; }
    const t = parseTaskLine(line, rel, i);
    if (!t) continue;
    all.push(t);
    if (!EXCLUDE.some((rule) => isExcludedBy(rel, rule))) inScope.push(t);
    if (serialiseTask(t) !== t.raw) {
      roundTripFailures.push(`${rel}:${i}\n    was:  ${JSON.stringify(t.raw)}\n    now:  ${JSON.stringify(serialiseTask(t))}`);
    }
  }
}

const open = (list: Task[]) => list.filter((t) => t.status === "todo");

console.log(`Tasks found in the whole vault:        ${all.length}  (${open(all).length} open)`);
console.log(`Tasks in scope with default excludes: ${inScope.length}  (${open(inScope).length} open)`);
console.log(`  -> excluded by "Archive" etc:       ${all.length - inScope.length}`);
console.log(`Task-like lines inside code blocks, skipped: ${skippedFence}`);
console.log(`\nRound-trip failures across all ${all.length} real tasks: ${roundTripFailures.length}`);
for (const f of roundTripFailures.slice(0, 10)) console.log(`  ${f}`);

console.log(`\nIn-scope open tasks by source folder:`);
const byFolder = new Map<string, number>();
for (const t of open(inScope)) {
  const folder = t.path.includes("/") ? t.path.split("/").slice(0, -1).join("/") : "(vault root)";
  byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
}
for (const [f, n] of [...byFolder.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${f}`);
}

console.log(`\nSample in-scope open tasks:`);
for (const t of open(inScope).slice(0, 10)) {
  console.log(`  ${displayText(t.description).slice(0, 66).padEnd(66)} ${t.path.slice(0, 32)}`);
}
