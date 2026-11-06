import { parseTaskLine, serialiseTask, buildTaskLine, displayText, ticketFromTask } from "../src/taskFormat";
import { parseEntry, parseDateToken } from "../src/quickParse";
import { insertUnderHeading, isWithin, isExcludedBy } from "../src/taskStore";
import { replaceSection } from "../src/dailyNotes";
import { bucketFor, relativeLabel, daysBetween, startOfWeek } from "../src/dates";

let pass = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
}

// ---------------------------------------------------------- round-tripping
// Any line we parse must serialise back to itself, byte for byte.
const roundTripCases = [
  "- [ ] Fix UPS service mapping ⏫ 📅 2026-11-06",
  "- [x] Deploy EPCIS changes ✅ 2026-11-03",
  "- [ ] Review AS2 MDN MIC 🔽 📅 2026-11-10",
  "- [ ] Plain task with no metadata",
  "    - [ ] Indented subtask 🔺 📅 2026-12-01",
  "* [ ] Star bullet 🔼",
  "- [/] In progress task 📅 2026-11-05",
  "- [-] Cancelled task ❌ 2026-11-01",
  "- [ ] Task with tags #ticket/T3F-340 #urgent 📅 2026-11-07",
  "- [ ] Recurring task 🔁 every week 📅 2026-11-09",
  "- [ ] All fields ⏫ 🔁 every day 🛫 2026-11-01 ⏳ 2026-11-02 📅 2026-11-03 ➕ 2026-10-30",
  "- [ ] Task with block ref 📅 2026-11-08 ^abc123",
  "- [ ] Wiki link [[T3F-340]] and a URL [docs](https://example.com) ⏫",
  "- [ ]",
  "1. [ ] Numbered task 📅 2026-11-07",
  "\t- [x]  Wide gap after the checkbox",
  "- [x] Trailing line break  ",
  "\t\t- [x]  Deep indent, wide gap, and a trailing space ",
  "-   [ ]   Wide gaps everywhere",
];

for (const line of roundTripCases) {
  const parsed = parseTaskLine(line, "Tasks.md", 0);
  if (!parsed) { failures.push(`round-trip: failed to parse: ${line}`); continue; }
  check(`round-trip: ${line.slice(0, 44)}`, serialiseTask(parsed), line);
}

// Non-tasks must not parse.
for (const notATask of ["- just a bullet", "# Heading", "plain text", "- [ ]x no space", "-[ ] no bullet space"]) {
  check(`not a task: ${notATask}`, parseTaskLine(notATask, "f.md", 0), null);
}

// ------------------------------------------------------------ field values
const t = parseTaskLine("- [ ] Fix mapping ⏫ 📅 2026-11-06 #ticket/T3F-340", "f.md", 3)!;
check("priority parsed", t.priority, "high");
check("due parsed", t.due, "2026-11-06");
check("line recorded", t.line, 3);
check("ticket from tag", t.ticket, "T3F-340");
check("tags parsed", t.tags, ["ticket/T3F-340"]);
check("display drops tag", displayText(t.description), "Fix mapping");

const done = parseTaskLine("- [x] Shipped ✅ 2026-11-03", "f.md", 0)!;
check("done status", done.status, "done");
check("done date", done.done, "2026-11-03");

check("bare ticket key", ticketFromTask("Fix T3F-340 mapping", []), "T3F-340");
check("no ticket", ticketFromTask("Just a task", []), null);

// Changing priority must preserve every other field.
const rich = parseTaskLine("- [ ] All ⏫ 🔁 every day 🛫 2026-11-01 ⏳ 2026-11-02 📅 2026-11-03 ➕ 2026-10-30", "f.md", 0)!;
check(
  "priority change preserves fields",
  serialiseTask({ ...rich, priority: "lowest" }),
  "- [ ] All ⏬ 🔁 every day 🛫 2026-11-01 ⏳ 2026-11-02 📅 2026-11-03 ➕ 2026-10-30",
);
check(
  "clearing priority",
  serialiseTask({ ...rich, priority: "normal" }),
  "- [ ] All 🔁 every day 🛫 2026-11-01 ⏳ 2026-11-02 📅 2026-11-03 ➕ 2026-10-30",
);
// Metadata is canonicalised to the Tasks plugin's own field order:
// description first, then the emoji fields. A tag written after the metadata
// therefore moves in front of it the first time the plugin rewrites the line.
check(
  "ticking a task stamps the done date and canonicalises field order",
  serialiseTask({ ...t, status: "done", done: "2026-11-04" }),
  "- [x] Fix mapping #ticket/T3F-340 ⏫ 📅 2026-11-06 ✅ 2026-11-04",
);
check(
  "tags before metadata are left in place",
  serialiseTask({
    ...parseTaskLine("- [ ] Task #urgent ⏫ 📅 2026-11-07", "f.md", 0)!,
    status: "done",
    done: "2026-11-04",
  }),
  "- [x] Task #urgent ⏫ 📅 2026-11-07 ✅ 2026-11-04",
);

// -------------------------------------------------------------- buildTask
check("build plain", buildTaskLine({ description: "Hello" }), "- [ ] Hello");
check("build full", buildTaskLine({ description: "Hello", priority: "highest", due: "2026-11-09" }), "- [ ] Hello 🔺 📅 2026-11-09");

// ------------------------------------------- whitespace must be preserved
// Hand-aligned columns appear throughout the real vault; ticking a checkbox
// must not reformat the line.
const aligned = "- [x] PMW12093    76329-3318-01    10-failed OET";
const alignedParsed = parseTaskLine(aligned, "f.md", 0)!;
check("aligned columns preserved", serialiseTask(alignedParsed), aligned);
check("double space preserved", serialiseTask(parseTaskLine("- [ ] a  b  c", "f.md", 0)!), "- [ ] a  b  c");
check("tab indent preserved", serialiseTask(parseTaskLine("\t- [x] indented  wide", "f.md", 0)!), "\t- [x] indented  wide");
check(
  "aligned plus metadata",
  serialiseTask(parseTaskLine("- [ ] a    b ⏫ 📅 2026-11-06", "f.md", 0)!),
  "- [ ] a    b ⏫ 📅 2026-11-06",
);
check(
  "unticking an aligned task only changes the box",
  serialiseTask({ ...alignedParsed, status: "todo", done: null }),
  "- [ ] PMW12093    76329-3318-01    10-failed OET",
);
check(
  "backtick and bold content untouched",
  serialiseTask(parseTaskLine("- [x] Save PO -> `Api\\PurchaseOrderController::store`  via **webhook**", "f.md", 0)!),
  "- [x] Save PO -> `Api\\PurchaseOrderController::store`  via **webhook**",
);

// ------------------------------------------------------------- shorthand
check("shorthand !1 @tomorrow", parseEntry("Ship fix !1 @tomorrow", "2026-11-04"), { description: "Ship fix", priority: "highest", due: "2026-11-05" });
check("shorthand !high", parseEntry("Thing !high", "2026-11-04"), { description: "Thing", priority: "high", due: null });
check("shorthand keeps tags", parseEntry("Thing #ticket/T3F-1 !2 @today", "2026-11-04"), { description: "Thing #ticket/T3F-1", priority: "high", due: "2026-11-04" });
check("shorthand no tokens", parseEntry("Just do it", "2026-11-04"), { description: "Just do it", priority: null, due: null });
check("unknown ! left alone", parseEntry("Ship it! now", "2026-11-04"), { description: "Ship it! now", priority: null, due: null });
check("date token iso", parseDateToken("2026-12-25", "2026-11-04"), "2026-12-25");
check("date token weekday", parseDateToken("fri", "2026-11-04"), "2026-11-06");
check("date token same weekday is next week", parseDateToken("wed", "2026-11-04"), "2026-11-11");
check("date token slash future", parseDateToken("12/25", "2026-11-04"), "2026-12-25");
check("date token slash past rolls over", parseDateToken("1/5", "2026-11-04"), "2027-01-05");
check("date token plus days", parseDateToken("+10", "2026-11-04"), "2026-11-14");
check("date token garbage", parseDateToken("someday", "2026-11-04"), null);

// --------------------------------------------------------------- insertion
check("append to end", insertUnderHeading("# Tasks\n\n- [ ] One\n", "- [ ] Two", ""), "# Tasks\n\n- [ ] One\n- [ ] Two\n");
check("append to empty file", insertUnderHeading("", "- [ ] One", ""), "- [ ] One\n");
check(
  "insert under existing heading",
  insertUnderHeading("## Inbox\n\n- [ ] One\n\n## Done\n\n- [x] Old\n", "- [ ] Two", "## Inbox"),
  "## Inbox\n\n- [ ] One\n- [ ] Two\n\n## Done\n\n- [x] Old\n",
);
check(
  "heading appended when missing",
  insertUnderHeading("# Tasks\n", "- [ ] One", "## Inbox"),
  "# Tasks\n## Inbox\n- [ ] One\n",
);

// --------------------------------------------------------- section replace
check(
  "replace existing section",
  replaceSection("# Day\n\nNotes here\n\n## Daily Summary\n\nold text\n\n## Other\n\nkeep me\n", "## Daily Summary", "new text"),
  "# Day\n\nNotes here\n\n## Daily Summary\n\nnew text\n\n## Other\n\nkeep me\n",
);
check(
  "append section when missing",
  replaceSection("# Day\n\nNotes here\n", "## Daily Summary", "new text"),
  "# Day\n\nNotes here\n\n## Daily Summary\n\nnew text\n",
);
check(
  "replace section at end of file",
  replaceSection("# Day\n\n## Daily Summary\n\nold\n", "## Daily Summary", "new"),
  "# Day\n\n## Daily Summary\n\nnew\n",
);
check(
  "a deeper heading inside the section is kept",
  replaceSection("## Daily Summary\n\nold\n\n### Detail\n\nkeep\n\n## Next\n\nafter\n", "## Daily Summary", "new"),
  "## Daily Summary\n\nnew\n\n## Next\n\nafter\n",
);

// ------------------------------------------------------------------ scope
check("within folder", isWithin("Tickets/T3F-340.md", "Tickets"), true);
check("within nested", isWithin("Tickets/T3F-340/notes.md", "Tickets"), true);
check("not within prefix lookalike", isWithin("TicketsOld/x.md", "Tickets"), false);
check("folder itself", isWithin("Tickets", "Tickets"), true);

check("bare name matches any depth", isExcludedBy("Daily Notes/Archive/04-13-2026.md", "Archive"), true);
check("bare name matches nested", isExcludedBy("Tickets/Archive/T3F-101.md", "Archive"), true);
check("bare name is case insensitive", isExcludedBy("Daily Notes/archive/x.md", "Archive"), true);
check("bare name ignores file names", isExcludedBy("Notes/Archive.md", "Archive"), false);
check("bare name does not match partial", isExcludedBy("Daily Notes/Archived/x.md", "Archive"), false);
check("path rule is rooted", isExcludedBy("Daily Notes/Archive/x.md", "Daily Notes/Archive"), true);
check("path rule does not match elsewhere", isExcludedBy("Tickets/Archive/x.md", "Daily Notes/Archive"), false);
check("unrelated path", isExcludedBy("Tasks/Tasks.md", "Archive"), false);

// ------------------------------------------------------------------ dates
check("bucket overdue", bucketFor("2026-11-01", 7, "2026-11-04"), "overdue");
check("bucket today", bucketFor("2026-11-04", 7, "2026-11-04"), "today");
check("bucket tomorrow", bucketFor("2026-11-05", 7, "2026-11-04"), "tomorrow");
check("bucket upcoming", bucketFor("2026-11-09", 7, "2026-11-04"), "upcoming");
check("bucket beyond window", bucketFor("2026-12-30", 7, "2026-11-04"), "someday");
check("bucket no date", bucketFor(null, 7, "2026-11-04"), "someday");
check("relative today", relativeLabel("2026-11-04", "2026-11-04"), "Today");
check("relative overdue", relativeLabel("2026-11-01", "2026-11-04"), "3d ago");
check("days between", daysBetween("2026-11-04", "2026-11-09"), 5);
check("week starts monday", startOfWeek("2026-11-04"), "2026-11-02");


// Two trailing spaces are a markdown line break, so they must survive.
const br = parseTaskLine("- [ ] Needs a break  ", "f.md", 0)!;
check("trailing break captured", br.trailing, "  ");
check("trailing break survives a tick", serialiseTask({ ...br, status: "done", done: "2026-11-04" }), "- [x] Needs a break \u2705 2026-11-04  ");
check("checkbox gap captured", parseTaskLine("- [x]   text", "f.md", 0)!.boxGap, "   ");

// ------------------------------------------------------------------ report
console.log(`\n  ${pass} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL ${f}\n`);
process.exit(failures.length === 0 ? 0 : 1);
