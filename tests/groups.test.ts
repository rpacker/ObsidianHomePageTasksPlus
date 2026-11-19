import { parseTaskLine } from "../src/taskFormat";
import {
  ALL_GROUP_ID, MAX_TASK_GROUPS, OTHER_GROUP_ID, ROOT_FOLDER,
  assignFolder, createTaskGroup, groupDisplayName, groupIdForFolder,
  groupIdForPath, groupTasks, renameGroupFolder, sanitiseTaskGroups,
  topLevelFolder,
} from "../src/groups";
import {
  bucketByDate, bucketByPriority, buildHomeData, compareByDate,
  compareTasks, isClosed, taskComparator,
} from "../src/homeData";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings";
import { buildContext } from "../src/summary";
import { TASK_SORTS, type Task, type TaskGroupConfig } from "../src/types";

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
const names = (list: Task[]) => list.map(t => t.description);

// ------------------------------------------------------ top-level folder
check("nested path", topLevelFolder("Tickets/T3F-340/T3F-340.md"), "Tickets");
check("one level down", topLevelFolder("Daily Notes/11-04-2026.md"), "Daily Notes");
check("vault root note", topLevelFolder("Inbox.md"), ROOT_FOLDER);
check("leading slash is ignored", topLevelFolder("/Tasks/Tasks.md"), "Tasks");

// ------------------------------------------------------------ sanitising
check("missing config means no groups", sanitiseTaskGroups(undefined), []);
check("garbage config means no groups", sanitiseTaskGroups("nope"), []);
check("garbage entries are skipped",
  sanitiseTaskGroups([null, 7, { id: "g1", name: "Work", folders: ["Tickets"] }]),
  [{ id: "g1", name: "Work", folders: ["Tickets"] }]);

const five = sanitiseTaskGroups(
  ["a", "b", "c", "d", "e"].map((n, i) => ({ id: `g${i + 1}`, name: n, folders: [] })),
);
check("at most three groups survive", five.map(g => g.name), ["a", "b", "c"]);
check("the limit is three", MAX_TASK_GROUPS, 3);

check("a folder stays in the first group that lists it",
  sanitiseTaskGroups([
    { id: "g1", name: "Work", folders: ["Tickets", "Projects"] },
    { id: "g2", name: "Home", folders: ["Projects", "Personal"] },
  ]).map(g => g.folders),
  [["Tickets", "Projects"], ["Personal"]]);

check("duplicate and unknown ids are replaced with free ones",
  sanitiseTaskGroups([
    { id: "g2", name: "a", folders: [] },
    { id: "g2", name: "b", folders: [] },
    { id: "zzz", name: "c", folders: [] },
  ]).map(g => g.id),
  ["g2", "g1", "g3"]);

check("nested paths reduce to their top-level folder, names are trimmed",
  sanitiseTaskGroups([{ id: "g1", name: "  Work ", folders: ["Tickets/Archive", " Daily Notes ", "", 4, "/"] }]),
  [{ id: "g1", name: "Work", folders: ["Tickets", "Daily Notes", "/"] }]);

// -------------------------------------------------------- editing groups
const editable: TaskGroupConfig[] = [
  { id: "g1", name: "Work", folders: ["Tickets"] },
  { id: "g2", name: "", folders: [] },
];
check("named group keeps its name", groupDisplayName(editable[0], 0), "Work");
check("unnamed group falls back to its position", groupDisplayName(editable[1], 1), "Group 2");

assignFolder(editable, "Projects", "g1");
check("assigning adds the folder", editable[0].folders, ["Tickets", "Projects"]);
assignFolder(editable, "Tickets", "g2");
check("reassigning moves the folder", editable.map(g => g.folders), [["Projects"], ["Tickets"]]);
check("lookup finds the owner", groupIdForFolder(editable, "Tickets"), "g2");
assignFolder(editable, "Tickets", null);
check("unassigning removes it everywhere", editable.map(g => g.folders), [["Projects"], []]);
check("unassigned folder has no owner", groupIdForFolder(editable, "Tickets"), null);

check("a third group gets the free id", createTaskGroup(editable)?.id, "g3");
check("no fourth group",
  createTaskGroup([...editable, { id: "g3", name: "", folders: [] }]), null);
check("a freed id is reused",
  createTaskGroup([{ id: "g2", name: "", folders: [] }, { id: "g3", name: "", folders: [] }])?.id, "g1");

const renamable: TaskGroupConfig[] = [
  { id: "g1", name: "Work", folders: ["Tickets", "Projects"] },
  { id: "g2", name: "Home", folders: ["Personal"] },
];
check("renaming an assigned folder reports a change", renameGroupFolder(renamable, "Tickets", "Jira"), true);
check("the rename keeps the folder's place", renamable[0].folders, ["Jira", "Projects"]);
check("renaming an unassigned folder changes nothing", renameGroupFolder(renamable, "Elsewhere", "Somewhere"), false);
check("renaming onto a folder another group holds drops the old entry",
  [renameGroupFolder(renamable, "Jira", "Personal"), renamable.map(g => g.folders)],
  [true, [["Projects"], ["Personal"]]]);

// ------------------------------------------------------------ partitioning
const tasks: Task[] = [
  task("- [ ] Fix mapping ⏫ 📅 2026-11-01", "Tickets/T3F-340/T3F-340.md"),
  task("- [ ] Ship release 🔺 📅 2026-11-04", "Projects/Release.md"),
  task("- [ ] Book dentist 📅 2026-11-05", "Personal/Health.md"),
  task("- [ ] Loose note task", "Inbox.md"),
  task("- [ ] Standup follow-up 🔽 📅 2026-11-09", "Daily Notes/11-04-2026.md"),
  task("- [x] Closed ticket task ✅ 2026-11-04", "Tickets/T3F-341.md"),
];

const ungrouped = groupTasks(tasks, []);
check("no groups: one block", ungrouped.length, 1);
check("no groups: the block is the catch-all", ungrouped[0].id, ALL_GROUP_ID);
check("no groups: it holds everything", ungrouped[0].tasks.length, tasks.length);
check("no groups: every path maps to it", groupIdForPath([], "Tickets/x.md"), ALL_GROUP_ID);

const config: TaskGroupConfig[] = [
  { id: "g1", name: "Work", folders: ["Tickets", "Projects"] },
  { id: "g2", name: "Home", folders: ["Personal", ROOT_FOLDER] },
];
const blocks = groupTasks(tasks, config);
check("blocks follow the configured order, then Other", blocks.map(b => b.name), ["Work", "Home", "Other"]);
check("a group collects several folders", names(blocks[0].tasks), ["Fix mapping", "Ship release", "Closed ticket task"]);
check("the vault root can be assigned", names(blocks[1].tasks), ["Book dentist", "Loose note task"]);
check("unassigned folders fall to Other", names(blocks[2].tasks), ["Standup follow-up"]);
check("Other names the folders it gathered", blocks[2].folders, ["Daily Notes"]);
check("Other has the catch-all id", blocks[2].id, OTHER_GROUP_ID);
check("no task is lost or duplicated", blocks.reduce((n, b) => n + b.tasks.length, 0), tasks.length);
check("path lookup agrees with the partition",
  [groupIdForPath(config, "Projects/Release.md"), groupIdForPath(config, "Inbox.md"), groupIdForPath(config, "Daily Notes/x.md")],
  ["g1", "g2", OTHER_GROUP_ID]);

const allClaimed = groupTasks(tasks, [...config, { id: "g3", name: "Daily", folders: ["Daily Notes"] }]);
check("no Other block when every folder is claimed", allClaimed.map(b => b.name), ["Work", "Home", "Daily"]);
check("an empty group still has a block", groupTasks([], config).map(b => b.tasks.length), [0, 0]);
check("an unnamed group is shown by position",
  groupTasks(tasks, [{ id: "g3", name: "", folders: ["Tickets"] }])[0].name, "Group 1");

// ------------------------------------------------- snapshot and summary
const grouped = buildHomeData(tasks, [], [], { ...DEFAULT_SETTINGS, taskGroups: config }, TODAY);
check("snapshot is flagged as grouped", grouped.grouped, true);
check("snapshot carries the blocks", grouped.groups.map(g => g.id), ["g1", "g2", OTHER_GROUP_ID]);
const plain = buildHomeData(tasks, [], [], DEFAULT_SETTINGS, TODAY);
check("snapshot is ungrouped by default", [plain.grouped, plain.groups.length], [false, 1]);
check("grouping leaves the overall buckets alone", grouped.buckets, plain.buckets);
check("grouping leaves the summary alone", buildContext(grouped), buildContext(plain));

// ---------------------------------------------------- per-group sections
const work = blocks[0].tasks;
const hiddenDone = bucketByDate(work, { showCompleted: false, upcomingDays: 7, today: TODAY });
check("group buckets: overdue", names(hiddenDone.overdue), ["Fix mapping"]);
check("group buckets: today", names(hiddenDone.today), ["Ship release"]);
check("group buckets: completed hidden", Object.values(hiddenDone).flat().some(isClosed), false);

const shownDone = bucketByDate(work, { showCompleted: true, upcomingDays: 7, today: TODAY });
check("group buckets: completed shown on request", names(shownDone.someday), ["Closed ticket task"]);

const lanes = bucketByPriority(work, { showCompleted: false });
check("group lanes: highest", names(lanes.highest), ["Ship release"]);
check("group lanes: high", names(lanes.high), ["Fix mapping"]);
check("group lanes: completed hidden", names(lanes.normal), []);
check("group lanes: completed shown on request", names(bucketByPriority(work, { showCompleted: true }).normal), ["Closed ticket task"]);

// ------------------------------------------------------------ sort orders
const sortable: Task[] = [
  task("- [ ] Bravo 🔼 📅 2026-11-10"),
  task("- [ ] Alpha 🔽 📅 2026-11-12"),
  task("- [ ] Delta 🔺 📅 2026-11-10"),
  task("- [ ] Charlie"),
  task("- [x] Aardvark 🔺 📅 2026-11-01 ✅ 2026-11-02"),
];
const sorted = (sort: Parameters<typeof taskComparator>[0]) =>
  names([...sortable].sort(taskComparator(sort)));

check("date, earliest first", sorted("date-asc"), ["Delta", "Bravo", "Alpha", "Charlie", "Aardvark"]);
check("date, latest first", sorted("date-desc"), ["Alpha", "Delta", "Bravo", "Charlie", "Aardvark"]);
check("priority, highest first", sorted("priority-high"), ["Delta", "Bravo", "Charlie", "Alpha", "Aardvark"]);
check("priority, lowest first", sorted("priority-low"), ["Alpha", "Charlie", "Bravo", "Delta", "Aardvark"]);
check("name, A to Z", sorted("name-asc"), ["Alpha", "Bravo", "Charlie", "Delta", "Aardvark"]);
check("name, Z to A", sorted("name-desc"), ["Delta", "Charlie", "Bravo", "Alpha", "Aardvark"]);
check("closed tasks sink in every order",
  TASK_SORTS.map(s => sorted(s)[sortable.length - 1]), TASK_SORTS.map(() => "Aardvark"));
check("undated tasks stay last among open ones, whichever way dates run",
  [sorted("date-asc")[3], sorted("date-desc")[3]], ["Charlie", "Charlie"]);
check("the default order is the one the page always used",
  [taskComparator("date-asc") === compareByDate, taskComparator("priority-high") === compareTasks], [true, true]);

const bySort = bucketByDate(sortable, { showCompleted: true, upcomingDays: 30, today: TODAY, sort: "name-desc" });
check("the chosen order applies inside a bucket", names(bySort.upcoming), ["Delta", "Bravo", "Alpha"]);
check("and closed tasks keep their own bucket", names(bySort.overdue), ["Aardvark"]);

// -------------------------------------------------------------- settings
const fresh = mergeSettings(null);
check("fresh install: no groups", fresh.taskGroups, []);
check("fresh install: default sort", fresh.byDateSort, "date-asc");
check("fresh install: completed hidden by date", fresh.byDateShowCompleted, false);

const upgraded = mergeSettings({ hideCompleted: false });
check("upgrade: the old 'hide completed' choice carries over to the date card", upgraded.byDateShowCompleted, true);
check("an explicit choice wins over the old setting",
  mergeSettings({ hideCompleted: false, byDateShowCompleted: false }).byDateShowCompleted, false);
check("an unknown sort falls back to the default", mergeSettings({ byDateSort: "sideways" }).byDateSort, "date-asc");
check("a stored sort is kept", mergeSettings({ byDateSort: "priority-low" }).byDateSort, "priority-low");
check("stored groups are cleaned on load",
  mergeSettings({ taskGroups: [
    { id: "g1", name: "Work", folders: ["Tickets", "Tickets"] },
    { id: "g1", name: "Home", folders: ["Tickets", "Personal"] },
  ] }).taskGroups,
  [{ id: "g1", name: "Work", folders: ["Tickets"] }, { id: "g2", name: "Home", folders: ["Personal"] }]);
check("defaults are not shared between loads", mergeSettings(null).taskGroups === DEFAULT_SETTINGS.taskGroups, false);

console.log(`\n  ${pass} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL ${f}\n`);
process.exit(failures.length === 0 ? 0 : 1);
