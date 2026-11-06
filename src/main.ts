/**
 * Home Page Tasks Plus — a task-focused home page for Obsidian.
 *
 * Entry point: wires up the view, commands, ribbon icon, settings and the
 * vault watchers that keep the page current.
 */

import {
	Notice,
	Plugin,
	TFile,
	TFolder,
	WorkspaceLeaf,
	debounce,
	normalizePath,
} from "obsidian";
import { ClaudeService } from "./claude";
import { DailyNotesService } from "./dailyNotes";
import { todayISO } from "./dates";
import { buildHomeData, type HomeData } from "./homeData";
import { AddTaskModal } from "./modals/addTask";
import { TextPromptModal } from "./modals/textPrompt";
import { parseEntry } from "./quickParse";
import {
	DEFAULT_SETTINGS,
	HomePageSettingTab,
	mergeSettings,
	type HomePageSettings,
} from "./settings";
import { buildFallbackSummary, buildPrompt } from "./summary";
import { TaskStore } from "./taskStore";
import { TicketStore } from "./ticketStore";
import { HOME_VIEW_TYPE, HomeView } from "./view";
import type { Priority, Ticket } from "./types";

export default class HomePagePlugin extends Plugin {
	settings: HomePageSettings = { ...DEFAULT_SETTINGS };

	tasks!: TaskStore;
	tickets!: TicketStore;
	dailyNotes!: DailyNotesService;
	claude!: ClaudeService;

	/** Debounced so a burst of vault events causes one rescan. */
	private scheduleRefresh = debounce(
		() => {
			this.tasks.invalidate();
			this.refreshViews();
		},
		600,
		false,
	);

	async onload(): Promise<void> {
		await this.loadSettings();

		const getSettings = () => this.settings;
		this.tasks = new TaskStore(this.app, getSettings);
		this.tickets = new TicketStore(this.app, getSettings);
		this.dailyNotes = new DailyNotesService(this.app, getSettings);
		this.claude = new ClaudeService(this.app, getSettings);

		this.registerView(
			HOME_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new HomeView(leaf, this),
		);

		this.addRibbonIcon("home", "Open task home page", () => {
			void this.openHomePage();
		});

		this.addSettingTab(new HomePageSettingTab(this.app, this));
		this.registerCommands();
		this.registerVaultWatchers();

		if (this.settings.openOnStartup) {
			this.app.workspace.onLayoutReady(() => {
				void this.openHomePage();
			});
		}
	}

	onunload(): void {
		// Leaves are left in place deliberately: Obsidian restores them, and
		// detaching here would discard the user's layout on every reload.
	}

	// ---------------------------------------------------------------- settings

	async loadSettings(): Promise<void> {
		this.settings = mergeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ------------------------------------------------------------------- views

	/** Open, or reveal, the home page in the main area. */
	async openHomePage(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Every open home page view. */
	private views(): HomeView[] {
		return this.app.workspace
			.getLeavesOfType(HOME_VIEW_TYPE)
			.map((leaf) => leaf.view)
			.filter((view): view is HomeView => view instanceof HomeView);
	}

	/** Rescan and redraw every open home page. */
	refreshViews(): void {
		for (const view of this.views()) void view.refresh();
	}

	/** Gather the snapshot both the view and the summary are built from. */
	async loadHomeData(): Promise<HomeData> {
		const tasks = await this.tasks.all();
		const tickets = this.tickets.all(tasks);
		const notes = await this.dailyNotes.recent(
			this.settings.dailyNoteCount,
		);
		return buildHomeData(tasks, tickets, notes, this.settings, todayISO());
	}

	// ---------------------------------------------------------------- commands

	private registerCommands(): void {
		this.addCommand({
			id: "open-home-page",
			name: "Open home page",
			callback: () => void this.openHomePage(),
		});

		this.addCommand({
			id: "add-task",
			name: "Add task",
			callback: () => void this.openAddTaskModal(),
		});

		this.addCommand({
			id: "focus-quick-add",
			name: "Focus quick add",
			callback: () => {
				void (async () => {
					await this.openHomePage();
					const view = this.views()[0];
					view?.focusQuickAdd();
				})();
			},
		});

		this.addCommand({
			id: "open-today-note",
			name: "Open today's daily note",
			callback: () => void this.openTodayNote(),
		});

		this.addCommand({
			id: "summarise-today",
			name: "Summarise today into the daily note",
			callback: () => void this.summariseToday(),
		});

		this.addCommand({
			id: "new-ticket",
			name: "New ticket",
			callback: () => void this.promptNewTicket(),
		});

		this.addCommand({
			id: "refresh-home-page",
			name: "Refresh home page",
			callback: () => {
				this.tasks.invalidate();
				this.refreshViews();
			},
		});
	}

	// ------------------------------------------------------------------ actions

	/** Open the add-task dialog. */
	async openAddTaskModal(options?: {
		ticket?: Ticket;
		due?: string | null;
		description?: string;
	}): Promise<void> {
		const tasks = await this.tasks.all();
		const tickets = this.tickets.all(tasks);

		new AddTaskModal(
			this.app,
			{
				inboxPath: this.tasks.inboxPath(),
				dailyNotePath: this.dailyNotes.pathFor(todayISO()),
				tickets,
				initialTarget: options?.ticket?.notePath,
				initialDescription: options?.description,
				initialDue: options?.due ?? null,
			},
			async (result) => {
				try {
					const path = await this.tasks.addTask(result);
					new Notice(`Task added to ${path}.`);
				} catch (err) {
					new Notice(
						`Could not add the task: ${describe(err)}`,
						10000,
					);
				}
				this.refreshViews();
			},
		).open();
	}

	/** Add a task from a single shorthand line. */
	async quickAddTask(raw: string): Promise<void> {
		const parsed = parseEntry(raw);
		if (!parsed.description) return;

		try {
			await this.tasks.addTask({
				description: parsed.description,
				priority: parsed.priority ?? "normal",
				due: parsed.due,
			});
		} catch (err) {
			new Notice(`Could not add the task: ${describe(err)}`, 10000);
		}
	}

	/** Open today's daily note, creating it when it does not exist. */
	async openTodayNote(): Promise<void> {
		try {
			const { created } = await this.dailyNotes.openOrCreate();
			if (created) new Notice("Created today's daily note.");
		} catch (err) {
			new Notice(
				`Could not open today's daily note: ${describe(err)}`,
				10000,
			);
		}
		this.refreshViews();
	}

	/**
	 * Write a summary of the home page into today's daily note.
	 * Falls back to a generated summary when AI is off or the CLI fails.
	 */
	async summariseToday(): Promise<void> {
		const data = await this.loadHomeData();
		const iso = data.today;

		if (!this.settings.aiEnabled) {
			await this.writeSummary(iso, buildFallbackSummary(data), false);
			return;
		}

		const notice = new Notice("Asking Claude to summarise today…", 0);
		try {
			const prompt = buildPrompt(data, this.settings);
			const summary = await this.claude.summarise(prompt);
			notice.hide();
			await this.writeSummary(iso, summary, true);
		} catch (err) {
			notice.hide();
			new Notice(
				`Claude could not produce the summary, so a generated one was written instead. ${describe(err)}`,
				15000,
			);
			await this.writeSummary(iso, buildFallbackSummary(data), false);
		}
	}

	/** Write the summary and open the note. */
	private async writeSummary(
		iso: string,
		summary: string,
		fromAI: boolean,
	): Promise<void> {
		try {
			const file = await this.dailyNotes.writeSummary(iso, summary);
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			new Notice(
				fromAI
					? "Summary written to today's daily note."
					: "Generated summary written to today's daily note.",
			);
		} catch (err) {
			new Notice(
				`Could not write the summary: ${describe(err)}`,
				10000,
			);
		}
		this.refreshViews();
	}

	/** Ask for a ticket key, then create the note. */
	async promptNewTicket(): Promise<void> {
		new TextPromptModal(
			this.app,
			{
				title: "New ticket",
				description: this.settings.newTicketAsFolder
					? `Creates ${this.settings.ticketFolder}/KEY/KEY.md`
					: `Creates ${this.settings.ticketFolder}/KEY.md`,
				placeholder: "T3F-350",
				submitText: "Create ticket",
				validate: (value) =>
					/[\\/:*?"<>|]/.test(value)
						? "A ticket name cannot contain \\ / : * ? \" < > |"
						: null,
			},
			async (key) => {
				try {
					const path = await this.tickets.createTicket(key);
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						await this.app.workspace.getLeaf(false).openFile(file);
					}
					new Notice(`Created ${path}.`);
				} catch (err) {
					new Notice(
						`Could not create the ticket: ${describe(err)}`,
						10000,
					);
				}
				this.tasks.invalidate();
				this.refreshViews();
			},
		).open();
	}

	/** Reveal the ticket folder in the file explorer. */
	async revealTicketFolder(): Promise<void> {
		const path = normalizePath(this.settings.ticketFolder.trim());
		const folder = this.app.vault.getAbstractFileByPath(path);

		if (!(folder instanceof TFolder)) {
			new Notice(`No folder at "${path}".`);
			return;
		}

		// The file explorer's reveal command works on the active file, so the
		// most reliable thing we can do is open the folder's first note.
		const firstNote = folder.children.find(
			(child): child is TFile =>
				child instanceof TFile && child.extension === "md",
		);

		if (firstNote) {
			await this.app.workspace.getLeaf(false).openFile(firstNote);
		} else {
			new Notice(`"${path}" has no notes in it yet.`);
		}
	}

	// ------------------------------------------------------------------ watchers

	/**
	 * Keep the page current when files change.
	 *
	 * Only events touching the scan scope, the ticket folder or the daily note
	 * folder trigger a refresh, so editing an unrelated note costs nothing.
	 */
	private registerVaultWatchers(): void {
		const relevant = (path: string): boolean => {
			if (!path.endsWith(".md")) return false;
			if (this.tasks.isInScope(path)) return true;
			if (this.tickets.isTicketPath(path)) return true;

			const dailyFolder = this.settings.dailyNoteFolder.trim();
			if (dailyFolder && path.startsWith(`${dailyFolder}/`)) return true;
			return false;
		};

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && relevant(file.path)) {
					this.scheduleRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && relevant(file.path)) {
					this.scheduleRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && relevant(file.path)) {
					this.scheduleRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (
					file instanceof TFile &&
					(relevant(file.path) || relevant(oldPath))
				) {
					this.scheduleRefresh();
				}
			}),
		);
	}
}

/** Readable text for an unknown thrown value. */
function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Re-exported for the settings tab's typing. */
export type { Priority };
