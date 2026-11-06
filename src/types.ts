/** Core domain types shared across the plugin. */

/**
 * Task priority, mirroring the obsidian-tasks-plugin scale.
 * `normal` is the absence of any priority marker.
 */
export type Priority =
	| "highest"
	| "high"
	| "medium"
	| "normal"
	| "low"
	| "lowest";

export const PRIORITY_ORDER: Priority[] = [
	"highest",
	"high",
	"medium",
	"normal",
	"low",
	"lowest",
];

/** Checkbox status characters we understand. */
export type TaskStatus = "todo" | "done" | "inProgress" | "cancelled";

/** A single task parsed out of a markdown list line. */
export interface Task {
	/** Stable-enough identity: `path:line`. Recomputed on every scan. */
	id: string;
	/** Vault-relative path of the file holding the task. */
	path: string;
	/** 0-based line number within that file. */
	line: number;
	/** The full original line, including indentation and checkbox. */
	raw: string;
	/** Leading whitespace of the line, preserved on rewrite. */
	indent: string;
	/** List bullet used (`-`, `*` or `1.`). */
	bullet: string;
	/** Whitespace between the bullet and the checkbox, preserved verbatim. */
	bulletGap: string;
	/** Whitespace between the checkbox and the text, preserved verbatim. */
	boxGap: string;
	/**
	 * Trailing whitespace of the line, preserved verbatim.
	 * Two trailing spaces are a markdown line break, so this is meaningful
	 * content rather than noise.
	 */
	trailing: string;
	status: TaskStatus;
	/** Task text with all metadata fields stripped out. */
	description: string;
	priority: Priority;
	/** ISO `YYYY-MM-DD` dates, or null when absent. */
	due: string | null;
	scheduled: string | null;
	start: string | null;
	created: string | null;
	done: string | null;
	cancelled: string | null;
	/** Recurrence rule text following 🔁, preserved verbatim. */
	recurrence: string | null;
	/** Tags found in the description, without the leading `#`. */
	tags: string[];
	/** Ticket key this task belongs to, if any. */
	ticket: string | null;
	/** Trailing metadata we did not recognise, preserved verbatim. */
	trailer: string;
}

/** A ticket: either `Tickets/KEY.md` or `Tickets/KEY/`. */
export interface Ticket {
	/** The ticket key, e.g. `T3F-340`. */
	key: string;
	/** Display title (frontmatter title, first H1, or the key). */
	title: string;
	/** Vault path of the ticket's primary note. */
	notePath: string;
	/** Folder path when the ticket is a directory, else null. */
	folderPath: string | null;
	status: string | null;
	priority: Priority | null;
	/** ISO date pulled from frontmatter or a `Date:` line. */
	date: string | null;
	tags: string[];
	/** Tasks associated with this ticket. */
	tasks: Task[];
	/** Last modified time (ms) of the primary note. */
	mtime: number;
}

/** A daily note on disk, with its parsed date. */
export interface DailyNote {
	path: string;
	basename: string;
	/** ISO `YYYY-MM-DD` parsed from the filename. */
	date: string;
	/** First line of prose, used as a preview. */
	preview: string;
	mtime: number;
}

/** Buckets used by the "tasks by date" section. */
export type DateBucket = "overdue" | "today" | "tomorrow" | "upcoming" | "someday";
