import { parseTaskLine } from "../src/taskFormat";
import { buildHomeData, buildStats, sortTickets, effectiveDate, isClosed } from "../src/homeData";
import { DEFAULT_SETTINGS } from "../src/settings";
import { buildFallbackSummary, buildContext } from "../src/summary";
import type { Task, Ticket } from "../src/types";

let pass = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
}

const TODAY = "2026-11-04";
let lineNo = 0;
const task = (line: string, path = "Tasks.md"): Task =>
  parseTaskLine(line, path, lineNo++)!;

const tasks: Task[] = [
  task("- [ ] Overdue thing ⏫ 📅 2026-11-01"),
  task("- [ ] Due today 🔺 📅 2026-11-04"),
  task("- [ ] Due tomorrow 📅 2026-11-05"),
  task("- [ ] Next week 🔽 📅 2026-11-09"),
  task("- [ ] Far future 📅 2027-03-01"),
  task("- [ ] No date at all"),
  task("- [x] Done today ✅ 2026-11-04"),
  task("- [x] Done yesterday ✅ 2026-11-03"),
  task("- [x] Done last month ✅ 2026-10-01"),
  task("- [-] Cancelled thing ❌ 2026-11-02"),
];

// ------------------------------------------------------------- bucketing
const hidden = buildHomeData(tasks, [], [], { ...DEFAULT_SETTINGS, hideCompleted: true }, TODAY);
check("overdue bucket", hidden.buckets.overdue.map(t => t.description), ["Overdue thing"]);
check("today bucket", hidden.buckets.today.map(t => t.description), ["Due today"]);
check("tomorrow bucket", hidden.buckets.tomorrow.map(t => t.description), ["Due tomorrow"]);
check("upcoming bucket", hidden.buckets.upcoming.map(t => t.description), ["Next week"]);
check("someday holds far future and undated", hidden.buckets.someday.map(t => t.description), ["Far future", "No date at all"]);
check("completed hidden everywhere", Object.values(hidden.buckets).flat().filter(isClosed).length, 0);

// hideCompleted: false must actually show them, sorted to the bottom.
const shown = buildHomeData(tasks, [], [], { ...DEFAULT_SETTINGS, hideCompleted: false }, TODAY);
check("completed shown when the setting is off", Object.values(shown.buckets).flat().filter(isClosed).length, 4);
// A closed task is bucketed by its DUE date, not its completion date, so one
// with no due date belongs in "No date" however recently it was finished.
check(
  "closed tasks with no due date land in No date",
  shown.buckets.someday.map(t => t.description),
  // Undated tasks tie on priority and date, so they fall back to
  // alphabetical order; closed ones sit below the live ones.
  ["Far future", "No date at all", "Cancelled thing", "Done last month", "Done today", "Done yesterday"],
);
check("closed tasks sink below live work", shown.buckets.someday.slice(0, 2).every(t => !isClosed(t)), true);
// A closed task that DOES have a due date is bucketed by it, and still sinks.
const withDue = buildHomeData(
  [task("- [ ] Live one 📅 2026-11-04"), task("- [x] Finished 📅 2026-11-04 ✅ 2026-11-04")],
  [], [], { ...DEFAULT_SETTINGS, hideCompleted: false }, TODAY,
);
check("closed task with a due date uses it", withDue.buckets.today.map(t => t.description), ["Live one", "Finished"]);
check("full task list is always complete", shown.tasks.length, 10);

// -------------------------------------------------------------- priority
check("highest lane", hidden.byPriority.highest.map(t => t.description), ["Due today"]);
check("high lane", hidden.byPriority.high.map(t => t.description), ["Overdue thing"]);
check("low lane", hidden.byPriority.low.map(t => t.description), ["Next week"]);
check("normal lane", hidden.byPriority.normal.map(t => t.description), ["Due tomorrow", "Far future", "No date at all"]);

// ----------------------------------------------------------------- stats
const stats = buildStats(tasks, DEFAULT_SETTINGS, TODAY);
check("open total", stats.openTotal, 6);
check("overdue count", stats.overdue, 1);
check("due today count", stats.dueToday, 1);
check("completed today", stats.completedToday, 1);
check("completed this week (Mon 2026-11-02 onward)", stats.completedThisWeek, 2);
check("week has seven days", stats.week.length, 7);
check("week ends today", stats.week[6].date, TODAY);
check("week starts six days back", stats.week[0].date, "2026-10-29");
check("today's completion count", stats.week[6].completed, 1);
check("yesterday's completion count", stats.week[5].completed, 1);
check("streak counts consecutive days", stats.streak, 2);

// A gap breaks the streak.
const gapped = [task("- [x] a ✅ 2026-11-04"), task("- [x] b ✅ 2026-11-02")];
check("streak stops at a gap", buildStats(gapped, DEFAULT_SETTINGS, TODAY).streak, 1);
check("no completions means no streak", buildStats([task("- [ ] x")], DEFAULT_SETTINGS, TODAY).streak, 0);

// --------------------------------------------------------------- tickets
const mkTicket = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, title: key, notePath: `Tickets/${key}.md`, folderPath: null,
  status: null, priority: null, date: null, tags: [], tasks: [], mtime: 0, ...over,
});

const ordered = sortTickets([
  mkTicket("QUIET"),
  mkTicket("BUSY", { tasks: [task("- [ ] one"), task("- [ ] two")] }),
  mkTicket("SOME", { tasks: [task("- [ ] one")] }),
  mkTicket("CLOSED", { tasks: [task("- [x] done ✅ 2026-11-04")] }),
]);
check("tickets sort by open task count", ordered.map(t => t.key), ["BUSY", "SOME", "QUIET", "CLOSED"]);

// -------------------------------------------------- effective date order
check("due wins over scheduled", effectiveDate(task("- [ ] x ⏳ 2026-11-08 📅 2026-11-05")), "2026-11-05");
check("scheduled used when no due", effectiveDate(task("- [ ] x ⏳ 2026-11-08")), "2026-11-08");
check("start used as a last resort", effectiveDate(task("- [ ] x 🛫 2026-11-09")), "2026-11-09");
check("no dates at all", effectiveDate(task("- [ ] x")), null);

// ------------------------------------------------------------- summaries
const ticketed = buildHomeData(
  tasks,
  [mkTicket("T3F-340", { tasks: [task("- [ ] Fix mapping ⏫ 📅 2026-11-01")], status: "open" })],
  [],
  DEFAULT_SETTINGS,
  TODAY,
);
const context = buildContext(ticketed);
check("context names the date", context.includes("2026-11-04"), true);
check("context lists overdue", context.includes("## Overdue"), true);
check("context lists the ticket", context.includes("T3F-340"), true);
check("context carries the counts", context.includes("overdue: 1"), true);

const fallback = buildFallbackSummary(ticketed);
check("fallback mentions open count", fallback.includes("6 open tasks"), true);
check("fallback flags attention", fallback.includes("Needs attention today"), true);
check("fallback links the ticket", fallback.includes("[[T3F-340]]"), true);

const quiet = buildHomeData([], [], [], DEFAULT_SETTINGS, TODAY);
check("empty vault fallback is graceful", buildFallbackSummary(quiet).includes("Nothing due"), true);
check("empty vault stats", buildStats([], DEFAULT_SETTINGS, TODAY).openTotal, 0);

console.log(`\n  ${pass} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL ${f}\n`);
process.exit(failures.length === 0 ? 0 : 1);
