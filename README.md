# Home Page Tasks Plus

A task-focused home page for Obsidian. Hearth-shaped, but built around the
three things that actually matter in a work vault: **tasks**, **daily notes**
and **tickets**.

No calendar, no bookmarks, no favourites.

## What it does

A single home page view with five sections, each of which can be shown,
hidden and reordered from settings:

| Section | What it shows |
| --- | --- |
| **Tasks by date** | Overdue · Today · Tomorrow · Upcoming · No date, with inline checkboxes, priority badges and date chips |
| **Priority board** | One lane per priority — drag a task between lanes to re-prioritise it in the markdown |
| **Active tickets** | Tickets from your `Tickets/` folder with their open task counts, newest and busiest first |
| **Recent daily notes** | The last few daily notes with a one-line preview |
| **Stats** | Open / due / overdue / completed counts, a seven-day completion bar and a streak |

Above them sits a bar with a greeting, live counts, and a one-line quick-add
field.

## Tasks are plain markdown

Tasks are stored in [obsidian-tasks-plugin](https://publish.obsidian.md/tasks/)
format, so everything here stays interoperable with the Tasks plugin, Kanban,
checkbox-sync and your own hand-editing:

```markdown
- [ ] Fix UPS service mapping ⏫ 📅 2026-11-06 #ticket/T3F-340
- [x] Deploy EPCIS changes ✅ 2026-11-03
- [ ] Review AS2 MDN MIC 🔽 📅 2026-11-10
```

Priorities are `🔺` highest, `⏫` high, `🔼` medium, none, `🔽` low, `⏬`
lowest. Dates are `📅` due, `⏳` scheduled, `🛫` start, `➕` created,
`✅` done, `❌` cancelled. Checkbox states `[ ]`, `[x]`, `[/]` in progress and
`[-]` cancelled are all understood.

### Round-trip safety

This is the part worth trusting, because the plugin writes into notes you
care about:

- Anything on a task line the plugin does not understand — unknown emoji
  fields, block references, recurrence rules — is preserved verbatim.
- A line's exact whitespace shape is preserved: indentation, the gap between
  the checkbox and the text, hand-aligned columns, and trailing spaces (two
  trailing spaces are a markdown line break, so they are content).
- Before any write, the stored line is re-read and compared to what the home
  page last saw. If it changed underneath, the write is refused and the page
  refreshes instead of editing the wrong line.
- Task-like lines inside fenced code blocks are ignored, so the JSON samples
  in ticket notes are never mistaken for tasks.

The test suite checks this against every task line in a real 500-note vault:
all 1241 of them round-trip byte for byte.

The one deliberate change: metadata is written in the Tasks plugin's field
order (description, then emoji fields). A tag typed *after* the metadata moves
in front of it the first time the plugin rewrites that line.

## Adding tasks

**Quick add** — the field on the home page takes shorthand:

```
Ship the AS2 fix !1 @tomorrow #ticket/T3F-340
```

| Token | Meaning |
| --- | --- |
| `!1` … `!5` | Priority, highest to lowest |
| `!high`, `!medium`, `!low`, `!urgent` | Priority by name |
| `@today`, `@tomorrow`, `@mon`…`@sun` | Due date |
| `@2026-11-20`, `@11/20`, `@+10` | Due date, ISO / US / days ahead |
| `#tag`, `#ticket/KEY` | Left in the text; `#ticket/KEY` links the task to a ticket |

Unrecognised `!` and `@` text is left alone, so "Ship it! now" stays intact.

**Add task dialog** (ribbon, command, or the gear in the quick-add row) gives
you priority, due and scheduled date pickers, and a target: the inbox file,
today's daily note, or any ticket note.

## Marking and editing

- **Click the checkbox** to complete a task — it stamps `✅ <today>`, which is
  what feeds the completion stats.
- **Click the priority badge** or drag the task between board lanes to change
  priority.
- **Click the date chip** for a quick menu: today, tomorrow, in 3 days, next
  week, in two weeks, or clear it.
- **Click the text** to open the task in its file; **double-click** to edit
  the text in place, leaving its metadata untouched.
- **Right-click** (or the ⋮ button) for everything else: in progress,
  cancelled, open in a new tab, delete.

## Tickets

Both layouts are detected, so an existing vault needs no migration:

```
Tickets/T3F-340.md            a flat note
Tickets/T3F-340/T3F-340.md    a folder, so attachments have somewhere to live
```

For the folder form the primary note is `KEY.md`, else `index.md`,
`README.md`, `notes.md`, else the most recently modified note in the folder.
Status, priority and date are read from frontmatter (`status`, `priority`,
`date`/`due`, with a few aliases); `priority` accepts words or `p0`–`p4`.

A task belongs to a ticket when it lives inside the ticket's note or folder,
or when its text carries `#ticket/KEY` or a bare key like `T3F-340`.
Subfolders listed under **Not tickets** (default: `Archive`, `extra notes`)
are skipped.

New tickets get a frontmatter stub with Requirements / Tasks / Notes headings.

## Daily notes

The **New daily note** button creates today's note in the configured folder
using a moment-style filename format, optionally from a template
(`{{date}}`, `{{title}}`, `{{time}}`, `{{date:FORMAT}}` are substituted).

**Import from Periodic Notes** in settings copies the folder, format and
template from the Periodic Notes plugin, or the core Daily Notes plugin.

### The AI summary

**Summarise today** writes a summary of what the home page is showing into
today's daily note, under a configurable heading (default `## Daily Summary`),
replacing whatever was there before.

It works by running the **Claude Code CLI** locally:

- No API key is stored anywhere — it uses your existing `claude` sign-in.
- Nothing is sent until you press the button.
- The prompt carries the home page's own numbers as text, and tells the model
  not to read files or use tools, so the summary describes exactly what you
  were looking at and returns in one round trip.
- The vault is the process's working directory.

If the CLI is missing, unauthenticated or times out, a **generated summary**
is written instead — the same content, assembled locally — and the error is
reported in a notice. Turning **Enable AI summary** off always uses that path.

Settings let you set the executable path (useful when Obsidian's `PATH` does
not include `~/.local/bin`), a model override, the timeout, the heading, and
extra prompt instructions. **Run test** confirms the CLI is reachable.

## Settings

**Sections** — show, hide and reorder the five blocks.

**Tasks** — task folder and inbox filename for new tasks; an optional heading
to append under; which folders to scan (empty means the whole vault) and which
to exclude; the upcoming window; whether to show completed tasks; how many
tasks a group shows before "show all"; whether to stamp a created date; and
whether to open the home page on startup.

A bare exclude name like `Archive` matches a folder of that name at **any**
depth, so it covers `Daily Notes/Archive` and `Tickets/Archive` both. An entry
containing a slash is treated as a path from the vault root.

**Tickets** — ticket folder, non-ticket subfolders, and whether new tickets
get their own folder.

**Daily notes** — folder, filename format, template, how many to list, and the
Periodic Notes import.

**AI daily summary** — as described above.

## Commands

All available from the command palette, and bindable to hotkeys:

- Open home page — also on the ribbon (house icon)
- Add task
- Focus quick add
- Open today's daily note
- Summarise today into the daily note
- New ticket
- Refresh home page

## Development

```bash
npm install
npm run dev        # esbuild watch
npm run build      # typecheck, then a production bundle
npm run typecheck
npm test           # unit suites: parser round-tripping, dates, aggregation
```

The parser's guarantees are worth checking against your own vault before
trusting it with one:

```bash
VAULT="/path/to/your/vault" npm run test:vault
```

That is read-only. It reports how many tasks were found, how many were in
scope, how many task-like lines inside code blocks were correctly skipped,
and — the number that matters — how many task lines would **not** round-trip
byte for byte. It should be zero.

### Layout

```
src/
  main.ts            plugin entry: view, commands, ribbon, vault watchers
  view.ts            the home page: hero bar, quick add, section dispatch
  settings.ts        settings shape, defaults, settings tab
  types.ts           Task, Ticket, DailyNote
  taskFormat.ts      parsing and serialisation of Tasks-plugin format
  taskStore.ts       vault scanning and the safe write path
  ticketStore.ts     ticket discovery across both folder layouts
  dailyNotes.ts      daily note discovery, creation, summary insertion
  claude.ts          Claude Code CLI child process
  summary.ts         summary prompt and the local fallback summary
  homeData.ts        the snapshot both the view and the summary are built from
  dates.ts           local-time date helpers
  quickParse.ts      quick-add shorthand
  ui/                card shell, task row
  sections/          the five sections
  modals/            add task, text prompt
```

`homeData.ts` is the hinge: the view renders from that snapshot and the AI
summary is built from the same object, which is what makes the daily note a
summary of the home page rather than a second opinion about the vault.

## Installing

Desktop only — the AI summary shells out to a local process.

Copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/home-page-tasks-plus/`, or symlink a checkout:

```bash
ln -s "$(pwd)" "<vault>/.obsidian/plugins/home-page-tasks-plus"
```

Then enable it under **Settings → Community plugins**.
