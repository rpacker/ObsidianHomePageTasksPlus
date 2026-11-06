/**
 * Discovers tickets under the configured ticket folder.
 *
 * Two layouts are supported side by side, because real vaults contain both:
 *   Tickets/T3F-340.md            — a flat note
 *   Tickets/T3F-340/T3F-340.md    — a folder, so attachments have a home
 * For the folder form the primary note is, in order of preference:
 * `KEY.md`, `index.md`, `README.md`, or the most recently modified `.md`.
 */

import { App, TFile, TFolder, normalizePath } from "obsidian";
import { isWithin } from "./taskStore";
import type { HomePageSettings } from "./settings";
import type { Priority, Task, Ticket } from "./types";

/** Frontmatter keys we read, in priority order. */
const STATUS_KEYS = ["status", "state", "ticket-status"];
const PRIORITY_KEYS = ["priority", "ticket-priority"];
const DATE_KEYS = ["date", "due", "due-date", "created"];

const PRIORITY_WORDS: Record<string, Priority> = {
	highest: "highest",
	urgent: "highest",
	critical: "highest",
	blocker: "highest",
	p0: "highest",
	high: "high",
	p1: "high",
	medium: "medium",
	normal: "normal",
	p2: "medium",
	low: "low",
	p3: "low",
	lowest: "lowest",
	trivial: "lowest",
	p4: "lowest",
};

export class TicketStore {
	constructor(
		private app: App,
		private getSettings: () => HomePageSettings,
	) {}

	/** True when `path` sits inside the ticket folder. */
	isTicketPath(path: string): boolean {
		const root = this.getSettings().ticketFolder.trim();
		if (!root) return false;
		return isWithin(normalizePath(path), root);
	}

	/**
	 * Every ticket found, each with its associated tasks attached.
	 * `tasks` is the full task list from the task store.
	 */
	all(tasks: Task[]): Ticket[] {
		const s = this.getSettings();
		const root = s.ticketFolder.trim();
		if (!root) return [];

		const folder = this.app.vault.getAbstractFileByPath(
			normalizePath(root),
		);
		if (!(folder instanceof TFolder)) return [];

		const excluded = new Set(
			s.ticketExcludeFolders.map((f) => f.toLowerCase()),
		);
		const tickets: Ticket[] = [];

		for (const child of folder.children) {
			if (child instanceof TFile) {
				if (child.extension !== "md") continue;
				const ticket = this.fromFile(child, child.basename, null);
				if (ticket) tickets.push(ticket);
				continue;
			}

			if (child instanceof TFolder) {
				if (excluded.has(child.name.toLowerCase())) continue;
				const note = this.primaryNote(child);
				if (!note) continue;
				const ticket = this.fromFile(note, child.name, child.path);
				if (ticket) tickets.push(ticket);
			}
		}

		this.attachTasks(tickets, tasks);
		return tickets;
	}

	/** Choose the note that represents a ticket folder. */
	private primaryNote(folder: TFolder): TFile | null {
		const markdown = folder.children.filter(
			(c): c is TFile => c instanceof TFile && c.extension === "md",
		);
		if (markdown.length === 0) return null;

		const preferred = [
			folder.name.toLowerCase(),
			"index",
			"readme",
			"notes",
		];
		for (const name of preferred) {
			const hit = markdown.find((f) => f.basename.toLowerCase() === name);
			if (hit) return hit;
		}
		return markdown.sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
	}

	/** Build a ticket from its primary note. */
	private fromFile(
		file: TFile,
		key: string,
		folderPath: string | null,
	): Ticket | null {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;

		const status = firstString(fm, STATUS_KEYS);
		const priorityRaw = firstString(fm, PRIORITY_KEYS);
		const priority = priorityRaw
			? (PRIORITY_WORDS[priorityRaw.trim().toLowerCase()] ?? null)
			: null;

		let date = firstString(fm, DATE_KEYS);
		if (date) date = normaliseDate(date);

		const tags = (cache?.tags ?? [])
			.map((t) => t.tag.replace(/^#/, ""))
			.concat(toStringArray(fm.tags));

		const title =
			firstString(fm, ["title"]) ??
			cache?.headings?.find((h) => h.level === 1)?.heading ??
			key;

		return {
			key,
			title: title.trim() || key,
			notePath: file.path,
			folderPath,
			status: status?.trim() || null,
			priority,
			date: date ?? null,
			tags: [...new Set(tags)],
			tasks: [],
			mtime: file.stat.mtime,
		};
	}

	/**
	 * Link tasks to tickets.
	 * A task belongs to a ticket when it lives inside the ticket's note or
	 * folder, or when its text names the ticket key.
	 */
	private attachTasks(tickets: Ticket[], tasks: Task[]): void {
		const byKey = new Map<string, Ticket>();
		for (const t of tickets) byKey.set(t.key.toLowerCase(), t);

		for (const task of tasks) {
			let matched: Ticket | undefined;

			for (const ticket of tickets) {
				if (
					task.path === ticket.notePath ||
					(ticket.folderPath && isWithin(task.path, ticket.folderPath))
				) {
					matched = ticket;
					break;
				}
			}

			if (!matched && task.ticket) {
				matched = byKey.get(task.ticket.toLowerCase());
			}

			if (matched) matched.tasks.push(task);
		}
	}

	/** Create a new ticket note, honouring the folder-layout setting. */
	async createTicket(key: string): Promise<string> {
		const s = this.getSettings();
		const clean = key.trim().replace(/[\\/:*?"<>|]/g, "-");
		if (!clean) throw new Error("A ticket needs a name.");

		const root = s.ticketFolder.trim() || "Tickets";
		const path = s.newTicketAsFolder
			? normalizePath(`${root}/${clean}/${clean}.md`)
			: normalizePath(`${root}/${clean}.md`);

		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return path;

		const folder = path.split("/").slice(0, -1).join("/");
		if (folder) {
			const parts = folder.split("/");
			let soFar = "";
			for (const part of parts) {
				soFar = soFar ? `${soFar}/${part}` : part;
				if (
					!(
						this.app.vault.getAbstractFileByPath(soFar) instanceof
						TFolder
					)
				) {
					try {
						await this.app.vault.createFolder(soFar);
					} catch {
						// Already there.
					}
				}
			}
		}

		const today = new Date().toISOString().slice(0, 10);
		const body = [
			"---",
			`title: ${clean}`,
			"status: open",
			"priority: medium",
			`date: ${today}`,
			"tags:",
			"  - ticket",
			"---",
			"",
			`# ${clean}`,
			"",
			"## Requirements",
			"",
			"- ",
			"",
			"## Tasks",
			"",
			"## Notes",
			"",
		].join("\n");

		await this.app.vault.create(path, body);
		return path;
	}
}

/** First key present in `fm` whose value is a non-empty string or number. */
function firstString(
	fm: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const value = fm[key];
		if (typeof value === "string" && value.trim()) return value;
		if (typeof value === "number") return String(value);
	}
	return null;
}

/** Coerce a frontmatter tags value into an array of strings. */
function toStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((v): v is string => typeof v === "string");
	}
	if (typeof value === "string") {
		return value
			.split(/[,\s]+/)
			.map((s) => s.trim().replace(/^#/, ""))
			.filter(Boolean);
	}
	return [];
}

/** Coax common date spellings into `YYYY-MM-DD`. */
function normaliseDate(raw: string): string | null {
	const text = raw.trim();
	const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

	const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
	if (us) {
		const month = us[1].padStart(2, "0");
		const day = us[2].padStart(2, "0");
		return `${us[3]}-${month}-${day}`;
	}
	return null;
}
