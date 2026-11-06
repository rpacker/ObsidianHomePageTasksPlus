/**
 * Parsing and serialisation of tasks in obsidian-tasks-plugin format.
 *
 * The guiding rule here is round-trip safety: anything we do not understand on
 * a line is captured in `trailer` and written back out verbatim, so editing a
 * task through this plugin never silently drops metadata that another plugin
 * (or a future Tasks release) put there.
 */

import type { Priority, Task, TaskStatus } from "./types";

/** Priority emoji used by obsidian-tasks-plugin. */
export const PRIORITY_EMOJI: Record<Priority, string> = {
	highest: "🔺",
	high: "⏫",
	medium: "🔼",
	normal: "",
	low: "🔽",
	lowest: "⏬",
};

/** Human labels for the UI. */
export const PRIORITY_LABEL: Record<Priority, string> = {
	highest: "Highest",
	high: "High",
	medium: "Medium",
	normal: "Normal",
	low: "Low",
	lowest: "Lowest",
};

const EMOJI_TO_PRIORITY: Record<string, Priority> = {
	"🔺": "highest",
	"⏫": "high",
	"🔼": "medium",
	"🔽": "low",
	"⏬": "lowest",
};

/** Date field emoji. */
const DUE = "📅";
const SCHEDULED = "⏳";
const START = "🛫";
const CREATED = "➕";
const DONE = "✅";
const CANCELLED = "❌";
const RECURRENCE = "🔁";

/** Checkbox character for each status, and the reverse mapping. */
const STATUS_CHAR: Record<TaskStatus, string> = {
	todo: " ",
	done: "x",
	inProgress: "/",
	cancelled: "-",
};

function charToStatus(c: string): TaskStatus {
	switch (c.toLowerCase()) {
		case "x":
			return "done";
		case "/":
			return "inProgress";
		case "-":
			return "cancelled";
		default:
			return "todo";
	}
}

/**
 * Matches a markdown checkbox list item, capturing indent, bullet and state.
 *
 * Whitespace after the checkbox is required, matching Obsidian itself: a line
 * like `- [ ]x` is not a task, and treating it as one would mean rewriting it
 * with a space inserted.
 */
const TASK_LINE =
	/^([ \t]*)([-*+]|\d+[.)])([ \t]+)\[(.)\](?:([ \t]+)(.*))?$/;

/** `📅 2026-11-06` style field. Date may be missing or malformed. */
function dateFieldRegex(emoji: string): RegExp {
	return new RegExp(`\\s*${emoji}\\s*(\\d{4}-\\d{2}-\\d{2})`, "u");
}

/** True when the line looks like a markdown task of any status. */
export function isTaskLine(line: string): boolean {
	return TASK_LINE.test(line);
}

/**
 * Parse one markdown line into a {@link Task}.
 * Returns null when the line is not a checkbox list item.
 */
export function parseTaskLine(
	line: string,
	path: string,
	lineNumber: number,
): Task | null {
	const match = TASK_LINE.exec(line);
	if (!match) return null;

	const [, indent, bullet, bulletGap, statusChar, boxGapRaw, bodyRaw] = match;
	// Both groups are undefined for a bare `- [ ]` with nothing after it.
	// An empty gap is recorded as empty so that `- [ ]` and `- [ ] ` stay
	// distinct, rather than one being rewritten as the other.
	const boxGap = boxGapRaw ?? "";
	let body = bodyRaw ?? "";

	// Pull out each recognised field, removing it from the body as we go so
	// whatever remains is either description text or unknown metadata.
	const takeDate = (emoji: string): string | null => {
		const re = dateFieldRegex(emoji);
		const found = re.exec(body);
		if (!found) return null;
		// Remove the field together with the whitespace in front of it, so
		// taking a field out never leaves a gap behind.
		body = body.replace(found[0], "");
		return found[1];
	};

	const due = takeDate(DUE);
	const scheduled = takeDate(SCHEDULED);
	const start = takeDate(START);
	const created = takeDate(CREATED);
	const done = takeDate(DONE);
	const cancelled = takeDate(CANCELLED);

	// Recurrence runs to the next field emoji or end of line.
	let recurrence: string | null = null;
	const recIndex = body.indexOf(RECURRENCE);
	if (recIndex !== -1) {
		const after = body.slice(recIndex + RECURRENCE.length);
		const stop = after.search(
			/[\u{1F4C5}\u{23F3}\u{1F6EB}\u{2795}\u{2705}\u{274C}\u{1F53A}\u{23EB}\u{1F53C}\u{1F53D}\u{23EC}]/u,
		);
		const rule = stop === -1 ? after : after.slice(0, stop);
		recurrence = rule.trim() || null;

		// Cut the whitespace in front of the emoji out with it, so removing
		// the rule leaves no gap or trailing space behind.
		let cut = recIndex;
		while (cut > 0 && /[ \t]/.test(body.charAt(cut - 1))) cut--;

		body = body.slice(0, cut) + (stop === -1 ? "" : after.slice(stop));
	}

	let priority: Priority = "normal";
	for (const [emoji, value] of Object.entries(EMOJI_TO_PRIORITY)) {
		const index = body.indexOf(emoji);
		if (index !== -1) {
			priority = value;
			body = body.replace(new RegExp(`\\s*${emoji}`, "u"), "");
			break;
		}
	}

	// A bare block reference (`^abc123`) is metadata, not description.
	let trailer = "";
	const blockRef = /\s(\^[A-Za-z0-9-]+)\s*$/.exec(body);
	if (blockRef) {
		trailer = blockRef[1];
		body = body.slice(0, blockRef.index);
	}

	// Recurrence removal can leave a doubled space where the rule was cut out
	// of the middle of the metadata run; nothing else touches inner spacing.
	body = body.replace(/\s{2,}(?=[\u{1F4C5}\u{23F3}\u{1F6EB}\u{2795}\u{2705}\u{274C}])/gu, " ");

	// Trailing whitespace is content: two spaces mean a line break.
	const trailing = /[ \t]*$/.exec(body)?.[0] ?? "";

	// Only the edges are trimmed. Runs of spaces inside the text are left
	// alone, because people align columns with them and ticking a checkbox
	// must not reformat the line.
	const description = body.trim();
	const tags = extractTags(description);

	return {
		id: `${path}:${lineNumber}`,
		path,
		line: lineNumber,
		raw: line,
		indent,
		bullet,
		bulletGap,
		boxGap,
		trailing,
		status: charToStatus(statusChar),
		description,
		priority,
		due,
		scheduled,
		start,
		created,
		done,
		cancelled,
		recurrence,
		tags,
		ticket: ticketFromTask(description, tags),
		trailer,
	};
}

/** Tags in a description, returned without their leading `#`. */
export function extractTags(text: string): string[] {
	const out: string[] = [];
	const re = /(^|\s)#([A-Za-z0-9_\-/]+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) out.push(m[2]);
	return out;
}

/**
 * Infer the ticket a task belongs to.
 * Prefers an explicit `#ticket/KEY` tag, then a bare `KEY` like `T3F-340`.
 */
export function ticketFromTask(
	description: string,
	tags: string[],
): string | null {
	for (const tag of tags) {
		const parts = tag.split("/");
		if (parts.length >= 2 && parts[0].toLowerCase() === "ticket") {
			return parts.slice(1).join("/");
		}
	}
	const bare = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/.exec(description);
	return bare ? bare[1] : null;
}

/**
 * Render a task back to a markdown line.
 * Field order matches the Tasks plugin's own output so diffs stay small.
 */
export function serialiseTask(task: Task): string {
	const parts: string[] = [task.description];

	if (task.priority !== "normal") parts.push(PRIORITY_EMOJI[task.priority]);
	if (task.recurrence) parts.push(`${RECURRENCE} ${task.recurrence}`);
	if (task.start) parts.push(`${START} ${task.start}`);
	if (task.scheduled) parts.push(`${SCHEDULED} ${task.scheduled}`);
	if (task.due) parts.push(`${DUE} ${task.due}`);
	if (task.created) parts.push(`${CREATED} ${task.created}`);
	if (task.cancelled) parts.push(`${CANCELLED} ${task.cancelled}`);
	if (task.done) parts.push(`${DONE} ${task.done}`);
	if (task.trailer) parts.push(task.trailer);

	const body = parts.filter((p) => p.length > 0).join(" ");
	const checkbox = `${task.indent}${task.bullet}${task.bulletGap}[${STATUS_CHAR[task.status]}]`;
	// An empty task stays `- [ ]` rather than gaining a trailing space.
	if (!body) return `${checkbox}${task.boxGap}${task.trailing}`;
	// A task that gains text needs at least one space before it.
	return `${checkbox}${task.boxGap || " "}${body}${task.trailing}`;
}

/** Build a brand new task line from scratch. */
export function buildTaskLine(fields: {
	description: string;
	priority?: Priority;
	due?: string | null;
	scheduled?: string | null;
	created?: string | null;
	bullet?: string;
	indent?: string;
}): string {
	const task: Task = {
		id: "",
		path: "",
		line: 0,
		raw: "",
		indent: fields.indent ?? "",
		bullet: fields.bullet ?? "-",
		bulletGap: " ",
		boxGap: " ",
		trailing: "",
		status: "todo",
		description: fields.description.trim(),
		priority: fields.priority ?? "normal",
		due: fields.due ?? null,
		scheduled: fields.scheduled ?? null,
		start: null,
		created: fields.created ?? null,
		done: null,
		cancelled: null,
		recurrence: null,
		tags: extractTags(fields.description),
		ticket: null,
		trailer: "",
	};
	return serialiseTask(task);
}

/** Strip tags and wiki/markdown link syntax for compact display. */
export function displayText(description: string): string {
	return description
		.replace(/(^|\s)#[A-Za-z0-9_\-/]+/g, " ")
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}
