/**
 * Daily note discovery, creation and summary insertion.
 *
 * Filenames are formatted with Obsidian's bundled moment, so whatever format
 * the Periodic Notes plugin uses here works unchanged.
 */

import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import { toISO, todayISO } from "./dates";
import type { HomePageSettings } from "./settings";
import type { DailyNote } from "./types";

/** Folder/format/template read off another plugin's configuration. */
export interface DetectedConfig {
	folder: string;
	format: string;
	template: string;
}

export class DailyNotesService {
	constructor(
		private app: App,
		private getSettings: () => HomePageSettings,
	) {}

	/** Filename (without extension) for a given ISO date. */
	filenameFor(iso: string): string {
		const s = this.getSettings();
		const format = s.dailyNoteFormat || "YYYY-MM-DD";
		return moment(iso, "YYYY-MM-DD").format(format);
	}

	/** Full vault path for a given ISO date. */
	pathFor(iso: string): string {
		const folder = this.getSettings().dailyNoteFolder.trim();
		const name = `${this.filenameFor(iso)}.md`;
		return normalizePath(folder ? `${folder}/${name}` : name);
	}

	/** The existing note for a date, or null. */
	noteFor(iso: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(this.pathFor(iso));
		return file instanceof TFile ? file : null;
	}

	/** Parse an ISO date back out of a daily-note filename. */
	dateFromBasename(basename: string): string | null {
		const format = this.getSettings().dailyNoteFormat || "YYYY-MM-DD";
		const parsed = moment(basename, format, true);
		return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
	}

	/**
	 * Recent daily notes, newest first.
	 * Only files whose names parse under the configured format are returned,
	 * so stray notes in the folder are ignored.
	 */
	async recent(limit: number): Promise<DailyNote[]> {
		const folderPath = this.getSettings().dailyNoteFolder.trim();
		const folder = folderPath
			? this.app.vault.getAbstractFileByPath(normalizePath(folderPath))
			: this.app.vault.getRoot();

		if (!(folder instanceof TFolder)) return [];

		const candidates: { file: TFile; date: string }[] = [];
		for (const child of folder.children) {
			if (!(child instanceof TFile) || child.extension !== "md") continue;
			const date = this.dateFromBasename(child.basename);
			if (date) candidates.push({ file: child, date });
		}

		candidates.sort((a, b) => b.date.localeCompare(a.date));
		const slice = candidates.slice(0, Math.max(1, limit));

		return Promise.all(
			slice.map(async ({ file, date }) => ({
				path: file.path,
				basename: file.basename,
				date,
				preview: await this.previewOf(file),
				mtime: file.stat.mtime,
			})),
		);
	}

	/** First line of real prose in a note, for the list preview. */
	private async previewOf(file: TFile): Promise<string> {
		let content: string;
		try {
			content = await this.app.vault.cachedRead(file);
		} catch {
			return "";
		}

		const lines = content.split("\n");
		let inFrontmatter = false;
		let inFence = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			if (i === 0 && line === "---") {
				inFrontmatter = true;
				continue;
			}
			if (inFrontmatter) {
				if (line === "---") inFrontmatter = false;
				continue;
			}
			if (/^(```|~~~)/.test(line)) {
				inFence = !inFence;
				continue;
			}
			if (inFence || !line) continue;

			const cleaned = line
				.replace(/^#{1,6}\s*/, "")
				.replace(/^[-*+]\s+(\[.\]\s*)?/, "")
				.replace(/^\d+[.)]\s+/, "")
				.replace(/^>\s*/, "")
				.replace(/\*\*([^*]+)\*\*/g, "$1")
				.replace(/[*_`]/g, "")
				.trim();

			if (cleaned) {
				return cleaned.length > 140
					? `${cleaned.slice(0, 139)}…`
					: cleaned;
			}
		}
		return "";
	}

	/**
	 * Open today's daily note, creating it first if needed.
	 * Returns the file and whether it was newly created.
	 */
	async openOrCreate(
		iso = todayISO(),
		newLeaf = false,
	): Promise<{ file: TFile; created: boolean }> {
		const { file, created } = await this.ensure(iso);
		const leaf = this.app.workspace.getLeaf(newLeaf ? "tab" : false);
		await leaf.openFile(file);
		return { file, created };
	}

	/** Get or create the daily note for a date. */
	async ensure(iso = todayISO()): Promise<{ file: TFile; created: boolean }> {
		const existing = this.noteFor(iso);
		if (existing) return { file: existing, created: false };

		const path = this.pathFor(iso);
		const folder = path.split("/").slice(0, -1).join("/");
		if (folder) await this.ensureFolder(folder);

		const body = await this.initialContent(iso);

		try {
			const file = await this.app.vault.create(path, body);
			return { file, created: true };
		} catch (err) {
			const now = this.app.vault.getAbstractFileByPath(path);
			if (now instanceof TFile) return { file: now, created: false };
			throw err;
		}
	}

	/** Starting content for a new daily note. */
	private async initialContent(iso: string): Promise<string> {
		const templatePath = this.getSettings().dailyNoteTemplate.trim();
		if (templatePath) {
			const normalised = normalizePath(
				templatePath.endsWith(".md")
					? templatePath
					: `${templatePath}.md`,
			);
			const template =
				this.app.vault.getAbstractFileByPath(normalised);
			if (template instanceof TFile) {
				const raw = await this.app.vault.cachedRead(template);
				return this.applyTemplateTokens(raw, iso);
			}
		}

		const heading = moment(iso, "YYYY-MM-DD").format("dddd, MMMM D, YYYY");
		return `# ${heading}\n\n`;
	}

	/** Replace the handful of template tokens we support. */
	private applyTemplateTokens(raw: string, iso: string): string {
		const m = moment(iso, "YYYY-MM-DD");
		return raw
			.replace(/\{\{\s*date\s*\}\}/gi, m.format("YYYY-MM-DD"))
			.replace(/\{\{\s*title\s*\}\}/gi, this.filenameFor(iso))
			.replace(/\{\{\s*time\s*\}\}/gi, moment().format("HH:mm"))
			.replace(
				/\{\{\s*date\s*:\s*([^}]+)\s*\}\}/gi,
				(_full, fmt: string) => m.format(fmt.trim()),
			);
	}

	private async ensureFolder(path: string): Promise<void> {
		const parts = normalizePath(path).split("/");
		let soFar = "";
		for (const part of parts) {
			if (!part) continue;
			soFar = soFar ? `${soFar}/${part}` : part;
			if (
				this.app.vault.getAbstractFileByPath(soFar) instanceof TFolder
			) {
				continue;
			}
			try {
				await this.app.vault.createFolder(soFar);
			} catch {
				// Already exists.
			}
		}
	}

	/**
	 * Write `summary` into the daily note under the configured heading,
	 * replacing anything already in that section.
	 */
	async writeSummary(iso: string, summary: string): Promise<TFile> {
		const { file } = await this.ensure(iso);
		const heading = this.getSettings().summaryHeading.trim() ||
			"## Daily Summary";

		await this.app.vault.process(file, (data) =>
			replaceSection(data, heading, summary.trim()),
		);
		return file;
	}

	/**
	 * Read folder/format/template from Periodic Notes, falling back to the
	 * core Daily Notes plugin.
	 */
	detectConfig(): DetectedConfig | null {
		// Both plugin surfaces are untyped, so this reaches through `any`.
		const anyApp = this.app as unknown as {
			plugins?: {
				plugins?: Record<string, { settings?: Record<string, unknown> }>;
			};
			internalPlugins?: {
				getPluginById?: (id: string) => {
					instance?: { options?: Record<string, unknown> };
				} | null;
			};
		};

		const periodic =
			anyApp.plugins?.plugins?.["periodic-notes"]?.settings?.daily;
		if (periodic && typeof periodic === "object") {
			const daily = periodic as Record<string, unknown>;
			const format =
				typeof daily.format === "string" && daily.format
					? daily.format
					: "YYYY-MM-DD";
			return {
				folder:
					typeof daily.folder === "string" ? daily.folder : "",
				format,
				template:
					typeof daily.template === "string" ? daily.template : "",
			};
		}

		const core = anyApp.internalPlugins?.getPluginById?.("daily-notes");
		const options = core?.instance?.options;
		if (options && typeof options === "object") {
			const o = options as Record<string, unknown>;
			return {
				folder: typeof o.folder === "string" ? o.folder : "",
				format:
					typeof o.format === "string" && o.format
						? o.format
						: "YYYY-MM-DD",
				template: typeof o.template === "string" ? o.template : "",
			};
		}

		return null;
	}
}

/**
 * Replace the body under `heading` with `body`, appending the heading if the
 * document does not already contain it.
 */
export function replaceSection(
	data: string,
	heading: string,
	body: string,
): string {
	const lines = data.split("\n");
	const target = heading.trim().toLowerCase();
	const index = lines.findIndex((l) => l.trim().toLowerCase() === target);

	if (index === -1) {
		const trimmed = [...lines];
		while (
			trimmed.length > 0 &&
			trimmed[trimmed.length - 1].trim() === ""
		) {
			trimmed.pop();
		}
		return `${[...trimmed, "", heading, "", body, ""].join("\n")}`;
	}

	const depth = (/^#+/.exec(lines[index].trim())?.[0] ?? "##").length;
	let end = lines.length;
	for (let i = index + 1; i < lines.length; i++) {
		const m = /^(#+)\s/.exec(lines[i]);
		if (m && m[1].length <= depth) {
			end = i;
			break;
		}
	}

	const before = lines.slice(0, index + 1);
	const after = lines.slice(end);
	const rebuilt = [...before, "", body, ""];
	if (after.length > 0) rebuilt.push(...after);
	return rebuilt.join("\n");
}

/** Today's date, exported for convenience alongside this service. */
export function today(): string {
	return toISO(new Date());
}
