/** Plugin settings: shape, defaults, and the settings tab UI. */

import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	normalizePath,
} from "obsidian";
import type HomePagePlugin from "./main";

/** Identifiers for the toggleable/reorderable home page sections. */
export type SectionId =
	| "byDate"
	| "priorityBoard"
	| "tickets"
	| "dailyNotes"
	| "stats";

export const SECTION_LABELS: Record<SectionId, string> = {
	byDate: "Tasks by date",
	priorityBoard: "Priority board",
	tickets: "Active tickets",
	dailyNotes: "Recent daily notes",
	stats: "Stats",
};

export const SECTION_DESCRIPTIONS: Record<SectionId, string> = {
	byDate: "Overdue, today, tomorrow, upcoming and undated tasks.",
	priorityBoard: "Lanes by priority — drag a task between lanes to re-prioritise it.",
	tickets: "Tickets from your Tickets folder, with their open task counts.",
	dailyNotes: "The most recent daily notes, with a one-line preview.",
	stats: "Completion counts, overdue total and a seven-day activity bar.",
};

export interface SectionConfig {
	id: SectionId;
	enabled: boolean;
}

export interface HomePageSettings {
	/** Folder new task files are created in. */
	taskFolder: string;
	/** Filename of the default inbox task file inside `taskFolder`. */
	taskFileName: string;
	/** Heading new tasks are appended under; empty appends to end of file. */
	taskHeading: string;
	/**
	 * Folders scanned for tasks. Empty means the whole vault.
	 */
	scanFolders: string[];
	/** Folders never scanned for tasks, regardless of `scanFolders`. */
	excludeFolders: string[];

	/** Root folder holding tickets. */
	ticketFolder: string;
	/** Subfolder names inside `ticketFolder` that are not tickets. */
	ticketExcludeFolders: string[];
	/** Create new tickets as `Tickets/KEY/KEY.md` rather than `Tickets/KEY.md`. */
	newTicketAsFolder: boolean;

	/** Folder holding daily notes. */
	dailyNoteFolder: string;
	/** Moment-style filename format for daily notes. */
	dailyNoteFormat: string;
	/** Optional template file applied to brand new daily notes. */
	dailyNoteTemplate: string;
	/** How many recent daily notes the section lists. */
	dailyNoteCount: number;

	/** Section order and visibility. */
	sections: SectionConfig[];
	/** Days ahead that count as "upcoming". */
	upcomingDays: number;
	/** Hide completed tasks from the date and board sections. */
	hideCompleted: boolean;
	/** Max tasks rendered per group before a "show more" control. */
	maxPerGroup: number;
	/** Open the home page when Obsidian starts. */
	openOnStartup: boolean;
	/** Write a `➕ created` date onto tasks added by this plugin. */
	addCreatedDate: boolean;

	/** Enable the Claude-powered daily summary. */
	aiEnabled: boolean;
	/** Path to the `claude` executable. */
	claudePath: string;
	/** Optional model override passed as `--model`. */
	claudeModel: string;
	/** Timeout for the CLI call, in seconds. */
	claudeTimeoutSeconds: number;
	/** Heading the summary is written under in the daily note. */
	summaryHeading: string;
	/** Extra instructions appended to the summary prompt. */
	summaryExtraInstructions: string;
}

export const DEFAULT_SETTINGS: HomePageSettings = {
	taskFolder: "Tasks",
	taskFileName: "Tasks.md",
	taskHeading: "",
	scanFolders: [],
	excludeFolders: ["Templates", ".trash", "Archive"],

	ticketFolder: "Tickets",
	ticketExcludeFolders: ["Archive", "extra notes"],
	newTicketAsFolder: true,

	dailyNoteFolder: "Daily Notes",
	dailyNoteFormat: "MM-DD-YYYY",
	dailyNoteTemplate: "",
	dailyNoteCount: 7,

	sections: [
		{ id: "byDate", enabled: true },
		{ id: "priorityBoard", enabled: true },
		{ id: "tickets", enabled: true },
		{ id: "dailyNotes", enabled: true },
		{ id: "stats", enabled: true },
	],
	upcomingDays: 7,
	hideCompleted: true,
	maxPerGroup: 25,
	openOnStartup: false,
	addCreatedDate: false,

	aiEnabled: true,
	claudePath: "claude",
	claudeModel: "",
	claudeTimeoutSeconds: 180,
	summaryHeading: "## Daily Summary",
	summaryExtraInstructions: "",
};

/** Parse a comma or newline separated folder list into clean paths. */
export function parseFolderList(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map((s) => normalizePath(s));
}

/**
 * Merge stored settings over the defaults.
 * Section config is rebuilt so that a release adding a new section does not
 * leave upgraded users without it.
 */
export function mergeSettings(stored: unknown): HomePageSettings {
	const data = (stored ?? {}) as Partial<HomePageSettings>;
	const merged: HomePageSettings = { ...DEFAULT_SETTINGS, ...data };

	const known = new Set<SectionId>(
		Object.keys(SECTION_LABELS) as SectionId[],
	);
	const seen = new Set<SectionId>();
	const sections: SectionConfig[] = [];

	for (const entry of Array.isArray(data.sections) ? data.sections : []) {
		if (!entry || !known.has(entry.id) || seen.has(entry.id)) continue;
		seen.add(entry.id);
		sections.push({ id: entry.id, enabled: entry.enabled !== false });
	}
	for (const def of DEFAULT_SETTINGS.sections) {
		if (!seen.has(def.id)) sections.push({ ...def });
	}

	merged.sections = sections;
	merged.scanFolders = Array.isArray(data.scanFolders) ? data.scanFolders : [];
	merged.excludeFolders = Array.isArray(data.excludeFolders)
		? data.excludeFolders
		: [...DEFAULT_SETTINGS.excludeFolders];
	merged.ticketExcludeFolders = Array.isArray(data.ticketExcludeFolders)
		? data.ticketExcludeFolders
		: [...DEFAULT_SETTINGS.ticketExcludeFolders];
	return merged;
}

export class HomePageSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: HomePagePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderSections(containerEl);
		this.renderTasks(containerEl);
		this.renderTickets(containerEl);
		this.renderDailyNotes(containerEl);
		this.renderAI(containerEl);
	}

	/** Persist and refresh any open home page view. */
	private async save(rerender = true): Promise<void> {
		await this.plugin.saveSettings();
		if (rerender) this.plugin.refreshViews();
	}

	private renderSections(root: HTMLElement): void {
		new Setting(root).setName("Sections").setHeading();
		root.createEl("p", {
			cls: "hptp-settings-hint",
			text: "Show, hide and reorder the blocks on the home page.",
		});

		const list = root.createDiv({ cls: "hptp-section-list" });
		const sections = this.plugin.settings.sections;

		sections.forEach((section, index) => {
			const setting = new Setting(list)
				.setName(SECTION_LABELS[section.id])
				.setDesc(SECTION_DESCRIPTIONS[section.id]);

			setting.addExtraButton((b) =>
				b
					.setIcon("arrow-up")
					.setTooltip("Move up")
					.setDisabled(index === 0)
					.onClick(async () => {
						const [moved] = sections.splice(index, 1);
						sections.splice(index - 1, 0, moved);
						await this.save();
						this.display();
					}),
			);
			setting.addExtraButton((b) =>
				b
					.setIcon("arrow-down")
					.setTooltip("Move down")
					.setDisabled(index === sections.length - 1)
					.onClick(async () => {
						const [moved] = sections.splice(index, 1);
						sections.splice(index + 1, 0, moved);
						await this.save();
						this.display();
					}),
			);
			setting.addToggle((t) =>
				t.setValue(section.enabled).onChange(async (value) => {
					section.enabled = value;
					await this.save();
				}),
			);
		});
	}

	private renderTasks(root: HTMLElement): void {
		new Setting(root).setName("Tasks").setHeading();

		new Setting(root)
			.setName("Task folder")
			.setDesc("Folder new task files are created in. Created on demand.")
			.addText((t) =>
				t
					.setPlaceholder("Tasks")
					.setValue(this.plugin.settings.taskFolder)
					.onChange(async (v) => {
						this.plugin.settings.taskFolder = v.trim();
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Inbox file name")
			.setDesc(
				"File inside the task folder that new tasks are appended to.",
			)
			.addText((t) =>
				t
					.setPlaceholder("Tasks.md")
					.setValue(this.plugin.settings.taskFileName)
					.onChange(async (v) => {
						this.plugin.settings.taskFileName = v.trim();
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Append under heading")
			.setDesc(
				"Optional heading inside the inbox file, e.g. '## Inbox'. Leave empty to append to the end of the file.",
			)
			.addText((t) =>
				t
					.setPlaceholder("## Inbox")
					.setValue(this.plugin.settings.taskHeading)
					.onChange(async (v) => {
						this.plugin.settings.taskHeading = v.trim();
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Scan folders")
			.setDesc(
				"Comma or newline separated folders to search for tasks. Leave empty to scan the whole vault.",
			)
			.addTextArea((t) =>
				t
					.setPlaceholder("Tasks, Tickets, Daily Notes")
					.setValue(this.plugin.settings.scanFolders.join(", "))
					.onChange(async (v) => {
						this.plugin.settings.scanFolders = parseFolderList(v);
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Exclude folders")
			.setDesc("Folders never scanned for tasks.")
			.addTextArea((t) =>
				t
					.setPlaceholder("Templates, Archive")
					.setValue(this.plugin.settings.excludeFolders.join(", "))
					.onChange(async (v) => {
						this.plugin.settings.excludeFolders = parseFolderList(v);
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Upcoming window")
			.setDesc("How many days ahead count as 'upcoming'.")
			.addSlider((s) =>
				s
					.setLimits(2, 30, 1)
					.setValue(this.plugin.settings.upcomingDays)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.upcomingDays = v;
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Hide completed tasks")
			.setDesc(
				"Keep done and cancelled tasks out of the date groups and the board.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.hideCompleted)
					.onChange(async (v) => {
						this.plugin.settings.hideCompleted = v;
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Tasks shown per group")
			.setDesc("Longer groups get a 'show all' control.")
			.addSlider((s) =>
				s
					.setLimits(5, 100, 5)
					.setValue(this.plugin.settings.maxPerGroup)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.maxPerGroup = v;
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Stamp created date")
			.setDesc("Add a ➕ created date to tasks added from the home page.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.addCreatedDate)
					.onChange(async (v) => {
						this.plugin.settings.addCreatedDate = v;
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Open home page on startup")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.openOnStartup)
					.onChange(async (v) => {
						this.plugin.settings.openOnStartup = v;
						await this.save(false);
					}),
			);
	}

	private renderTickets(root: HTMLElement): void {
		new Setting(root).setName("Tickets").setHeading();

		new Setting(root)
			.setName("Ticket folder")
			.setDesc(
				"Both 'Tickets/KEY.md' and 'Tickets/KEY/KEY.md' layouts are detected.",
			)
			.addText((t) =>
				t
					.setPlaceholder("Tickets")
					.setValue(this.plugin.settings.ticketFolder)
					.onChange(async (v) => {
						this.plugin.settings.ticketFolder = v.trim();
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Not tickets")
			.setDesc(
				"Subfolders of the ticket folder to ignore, e.g. an archive.",
			)
			.addTextArea((t) =>
				t
					.setPlaceholder("Archive, extra notes")
					.setValue(
						this.plugin.settings.ticketExcludeFolders.join(", "),
					)
					.onChange(async (v) => {
						this.plugin.settings.ticketExcludeFolders =
							parseFolderList(v);
						await this.save();
					}),
			);

		new Setting(root)
			.setName("New tickets get their own folder")
			.setDesc(
				"On: 'Tickets/T3F-350/T3F-350.md', so attachments and sub-notes have somewhere to live. Off: a flat 'Tickets/T3F-350.md'.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.newTicketAsFolder)
					.onChange(async (v) => {
						this.plugin.settings.newTicketAsFolder = v;
						await this.save(false);
					}),
			);
	}

	private renderDailyNotes(root: HTMLElement): void {
		new Setting(root).setName("Daily notes").setHeading();

		new Setting(root)
			.setName("Daily note folder")
			.addText((t) =>
				t
					.setPlaceholder("Daily Notes")
					.setValue(this.plugin.settings.dailyNoteFolder)
					.onChange(async (v) => {
						this.plugin.settings.dailyNoteFolder = v.trim();
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Filename format")
			.setDesc("Moment.js format, matching your daily notes plugin.")
			.addText((t) =>
				t
					.setPlaceholder("MM-DD-YYYY")
					.setValue(this.plugin.settings.dailyNoteFormat)
					.onChange(async (v) => {
						this.plugin.settings.dailyNoteFormat = v.trim();
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Template file")
			.setDesc(
				"Optional. Applied only when a daily note is created by this plugin.",
			)
			.addText((t) =>
				t
					.setPlaceholder("Templates/Daily.md")
					.setValue(this.plugin.settings.dailyNoteTemplate)
					.onChange(async (v) => {
						this.plugin.settings.dailyNoteTemplate = v.trim();
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Notes listed")
			.addSlider((s) =>
				s
					.setLimits(3, 21, 1)
					.setValue(this.plugin.settings.dailyNoteCount)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.dailyNoteCount = v;
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Import from Periodic Notes")
			.setDesc(
				"Copy the folder and format from the Periodic Notes or core Daily Notes plugin.",
			)
			.addButton((b) =>
				b.setButtonText("Import").onClick(async () => {
					const found = this.plugin.dailyNotes.detectConfig();
					if (!found) {
						new Notice(
							"No Periodic Notes or Daily Notes configuration found.",
						);
						return;
					}
					this.plugin.settings.dailyNoteFolder = found.folder;
					this.plugin.settings.dailyNoteFormat = found.format;
					if (found.template) {
						this.plugin.settings.dailyNoteTemplate = found.template;
					}
					await this.save();
					new Notice(
						`Imported: ${found.folder || "vault root"} · ${found.format}`,
					);
					this.display();
				}),
			);
	}

	private renderAI(root: HTMLElement): void {
		new Setting(root).setName("AI daily summary").setHeading();
		root.createEl("p", {
			cls: "hptp-settings-hint",
			text: "The summary is produced by running the Claude Code CLI locally, with your vault as its working directory. No API key is stored, and nothing is sent unless you press the button.",
		});

		new Setting(root)
			.setName("Enable AI summary")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.aiEnabled).onChange(async (v) => {
					this.plugin.settings.aiEnabled = v;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Claude executable")
			.setDesc("Name on your PATH, or an absolute path.")
			.addText((t) =>
				t
					.setPlaceholder("claude")
					.setValue(this.plugin.settings.claudePath)
					.onChange(async (v) => {
						this.plugin.settings.claudePath = v.trim();
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Model")
			.setDesc("Optional override passed as --model. Empty uses your default.")
			.addText((t) =>
				t
					.setPlaceholder("claude-sonnet-5-5")
					.setValue(this.plugin.settings.claudeModel)
					.onChange(async (v) => {
						this.plugin.settings.claudeModel = v.trim();
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Timeout")
			.setDesc("Seconds before the CLI call is abandoned.")
			.addSlider((s) =>
				s
					.setLimits(30, 600, 15)
					.setValue(this.plugin.settings.claudeTimeoutSeconds)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.claudeTimeoutSeconds = v;
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Summary heading")
			.setDesc(
				"The summary replaces the content under this heading in the daily note.",
			)
			.addText((t) =>
				t
					.setPlaceholder("## Daily Summary")
					.setValue(this.plugin.settings.summaryHeading)
					.onChange(async (v) => {
						this.plugin.settings.summaryHeading = v.trim();
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Extra instructions")
			.setDesc("Appended to the prompt. Use it to set tone or focus.")
			.addTextArea((t) =>
				t
					.setPlaceholder(
						"Call out anything blocked on someone else.",
					)
					.setValue(this.plugin.settings.summaryExtraInstructions)
					.onChange(async (v) => {
						this.plugin.settings.summaryExtraInstructions = v;
						await this.save(false);
					}),
			);

		new Setting(root)
			.setName("Test the CLI")
			.setDesc("Checks that the executable runs and reports its version.")
			.addButton((b) =>
				b.setButtonText("Run test").onClick(async () => {
					b.setDisabled(true).setButtonText("Testing…");
					const result = await this.plugin.claude.testConnection();
					b.setDisabled(false).setButtonText("Run test");
					new Notice(result.message, result.ok ? 5000 : 12000);
				}),
			);
	}
}
