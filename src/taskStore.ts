/**
 * Reads tasks out of the vault and writes changes back.
 *
 * Writes go through `Vault.process`, which hands us the current file contents
 * and takes the replacement atomically. Before touching a line we re-check
 * that it still holds the task we think it does; if the file moved underneath
 * us the edit is refused rather than applied to the wrong line.
 */

import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
	buildTaskLine,
	isTaskLine,
	parseTaskLine,
	serialiseTask,
} from "./taskFormat";
import { todayISO } from "./dates";
import type { HomePageSettings } from "./settings";
import type { Priority, Task } from "./types";

/** Thrown when a task line no longer matches what we read. */
export class StaleTaskError extends Error {
	constructor() {
		super(
			"That task changed on disk since the home page last refreshed. Refreshing now.",
		);
		this.name = "StaleTaskError";
	}
}

export class TaskStore {
	private cache: Task[] = [];
	private cacheValid = false;

	constructor(
		private app: App,
		private getSettings: () => HomePageSettings,
	) {}

	/** Drop the cache so the next read rescans the vault. */
	invalidate(): void {
		this.cacheValid = false;
	}

	/** True when `path` is inside the configured scan scope. */
	isInScope(path: string): boolean {
		const s = this.getSettings();
		const p = normalizePath(path);

		for (const excluded of s.excludeFolders) {
			if (excluded && isExcludedBy(p, excluded)) return false;
		}
		if (s.scanFolders.length === 0) return true;
		return s.scanFolders.some((folder) => folder && isWithin(p, folder));
	}

	/** All tasks in scope, scanning the vault if the cache is cold. */
	async all(): Promise<Task[]> {
		if (this.cacheValid) return this.cache;

		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => this.isInScope(f.path));

		const results = await Promise.all(
			files.map((file) => this.tasksInFile(file)),
		);

		this.cache = results.flat();
		this.cacheValid = true;
		return this.cache;
	}

	/** Parse every task in one file. */
	async tasksInFile(file: TFile): Promise<Task[]> {
		let content: string;
		try {
			content = await this.app.vault.cachedRead(file);
		} catch {
			return [];
		}

		const out: Task[] = [];
		const lines = content.split("\n");
		let inFence = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Skip fenced code blocks: a "- [ ]" inside one is sample text,
			// not a task. Your ticket notes contain plenty of JSON blocks.
			if (/^\s*(```|~~~)/.test(line)) {
				inFence = !inFence;
				continue;
			}
			if (inFence) continue;

			if (!isTaskLine(line)) continue;
			const task = parseTaskLine(line, file.path, i);
			if (task) out.push(task);
		}
		return out;
	}

	/**
	 * Apply `mutate` to the task at `task.path:task.line`.
	 * Refuses the write when the stored line differs from `task.raw`.
	 */
	private async mutate(
		task: Task,
		mutate: (current: Task) => Task,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) throw new StaleTaskError();

		let failed = false;

		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			const stored = lines[task.line];

			if (stored === undefined || stored.trimEnd() !== task.raw.trimEnd()) {
				failed = true;
				return data;
			}

			const parsed = parseTaskLine(stored, task.path, task.line);
			if (!parsed) {
				failed = true;
				return data;
			}

			lines[task.line] = serialiseTask(mutate(parsed));
			return lines.join("\n");
		});

		this.invalidate();
		if (failed) throw new StaleTaskError();
	}

	/** Flip a task between todo and done, stamping or clearing ✅. */
	async toggleComplete(task: Task): Promise<void> {
		await this.mutate(task, (current) => {
			if (current.status === "done") {
				return { ...current, status: "todo", done: null };
			}
			return { ...current, status: "done", done: todayISO() };
		});
	}

	/** Set an explicit status. */
	async setStatus(task: Task, status: Task["status"]): Promise<void> {
		await this.mutate(task, (current) => ({
			...current,
			status,
			done: status === "done" ? (current.done ?? todayISO()) : null,
			cancelled:
				status === "cancelled"
					? (current.cancelled ?? todayISO())
					: null,
		}));
	}

	async setPriority(task: Task, priority: Priority): Promise<void> {
		await this.mutate(task, (current) => ({ ...current, priority }));
	}

	async setDue(task: Task, due: string | null): Promise<void> {
		await this.mutate(task, (current) => ({ ...current, due }));
	}

	/** Replace a task's description, keeping all of its metadata. */
	async setDescription(task: Task, description: string): Promise<void> {
		const trimmed = description.trim();
		if (!trimmed) return;
		await this.mutate(task, (current) => ({
			...current,
			description: trimmed,
		}));
	}

	/** Delete the task's line outright. */
	async remove(task: Task): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) throw new StaleTaskError();

		let failed = false;
		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			const stored = lines[task.line];
			if (stored === undefined || stored.trimEnd() !== task.raw.trimEnd()) {
				failed = true;
				return data;
			}
			lines.splice(task.line, 1);
			return lines.join("\n");
		});

		this.invalidate();
		if (failed) throw new StaleTaskError();
	}

	/** Vault path of the default inbox file. */
	inboxPath(): string {
		const s = this.getSettings();
		const folder = s.taskFolder.trim();
		const name = s.taskFileName.trim() || "Tasks.md";
		const withExt = name.endsWith(".md") ? name : `${name}.md`;
		return normalizePath(folder ? `${folder}/${withExt}` : withExt);
	}

	/**
	 * Append a new task.
	 * `targetPath` defaults to the inbox file, which is created if missing.
	 */
	async addTask(fields: {
		description: string;
		priority?: Priority;
		due?: string | null;
		scheduled?: string | null;
		targetPath?: string;
	}): Promise<string> {
		const s = this.getSettings();
		const line = buildTaskLine({
			description: fields.description,
			priority: fields.priority,
			due: fields.due ?? null,
			scheduled: fields.scheduled ?? null,
			created: s.addCreatedDate ? todayISO() : null,
		});

		const path = normalizePath(fields.targetPath || this.inboxPath());
		const file = await this.ensureFile(path);

		await this.app.vault.process(file, (data) =>
			insertUnderHeading(data, line, s.taskHeading),
		);

		this.invalidate();
		return path;
	}

	/** Get a file, creating it (and its folders) when absent. */
	async ensureFile(path: string): Promise<TFile> {
		const normalised = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalised);
		if (existing instanceof TFile) return existing;

		const folder = normalised.split("/").slice(0, -1).join("/");
		if (folder) await this.ensureFolder(folder);

		const s = this.getSettings();
		const heading = s.taskHeading ? `${s.taskHeading}\n` : "";
		try {
			return await this.app.vault.create(normalised, heading);
		} catch (err) {
			// Lost a race with another create; take whatever is there now.
			const now = this.app.vault.getAbstractFileByPath(normalised);
			if (now instanceof TFile) return now;
			throw err;
		}
	}

	/** Create a folder and any missing parents. */
	async ensureFolder(path: string): Promise<void> {
		const normalised = normalizePath(path);
		if (!normalised || normalised === "/") return;
		if (this.app.vault.getAbstractFileByPath(normalised) instanceof TFolder) {
			return;
		}
		try {
			await this.app.vault.createFolder(normalised);
		} catch {
			// Already exists, or was created concurrently.
		}
	}
}

/**
 * True when `path` is excluded by the entry `rule`.
 *
 * A rule containing a slash is a path, matched from the vault root:
 * `Daily Notes/Archive` excludes only that folder. A bare name matches a
 * folder of that name at any depth, so `Archive` covers both
 * `Daily Notes/Archive` and `Tickets/Archive` — which is what people mean
 * when they type it.
 */
export function isExcludedBy(path: string, rule: string): boolean {
	const clean = normalizePath(rule).replace(/\/$/, "");
	if (!clean || clean === "/") return false;

	if (clean.includes("/")) return isWithin(path, clean);

	const segments = path.split("/");
	// The last segment is the file itself, so only folders are considered.
	return segments
		.slice(0, -1)
		.some((segment) => segment.toLowerCase() === clean.toLowerCase());
}

/** True when `path` is the folder itself or sits inside it. */
export function isWithin(path: string, folder: string): boolean {
	const f = normalizePath(folder).replace(/\/$/, "");
	if (!f || f === "/") return true;
	return path === f || path.startsWith(`${f}/`);
}

/**
 * Insert `line` into `data`.
 *
 * With no heading configured the line goes at the end of the file. With one,
 * it goes at the end of that heading's section, and the heading is appended
 * first if the file does not already have it.
 */
export function insertUnderHeading(
	data: string,
	line: string,
	heading: string,
): string {
	const lines = data.split("\n");

	if (!heading) {
		return appendLine(lines, line);
	}

	const target = heading.trim().toLowerCase();
	const headingIndex = lines.findIndex(
		(l) => l.trim().toLowerCase() === target,
	);

	if (headingIndex === -1) {
		const withHeading = appendLine(lines, heading).split("\n");
		return appendLine(withHeading, line);
	}

	// Walk to the end of this section: the next heading of the same or
	// shallower depth, or end of file.
	const depth = (/^#+/.exec(lines[headingIndex].trim())?.[0] ?? "#").length;
	let end = lines.length;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		const m = /^(#+)\s/.exec(lines[i]);
		if (m && m[1].length <= depth) {
			end = i;
			break;
		}
	}

	// Step back over trailing blank lines so the task joins the list above.
	let insertAt = end;
	while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") {
		insertAt--;
	}

	lines.splice(insertAt, 0, line);
	return lines.join("\n");
}

/** Append a line, keeping exactly one newline before it. */
function appendLine(lines: string[], line: string): string {
	const copy = [...lines];
	while (copy.length > 0 && copy[copy.length - 1].trim() === "") copy.pop();
	if (copy.length > 0) copy.push(line);
	else copy.push(line);
	return `${copy.join("\n")}\n`;
}
