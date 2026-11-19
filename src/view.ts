/**
 * The home page view.
 *
 * Rendering is a full redraw of a lightweight DOM tree. That keeps state
 * handling simple and is fast enough for the scale involved — but the scroll
 * position and the focused quick-add field are preserved across redraws so a
 * refresh never feels like it threw your place away.
 */

import {
	ItemView,
	Notice,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { greeting, todayISO } from "./dates";
import { buildHomeData, type HomeData } from "./homeData";
import { parseEntry } from "./quickParse";
import { renderByDate } from "./sections/byDate";
import { renderDailyNotes } from "./sections/dailyNotes";
import { renderPriorityBoard } from "./sections/priorityBoard";
import { renderStats } from "./sections/stats";
import { renderTickets } from "./sections/tickets";
import type { SectionContext } from "./sections/context";
import { StaleTaskError } from "./taskStore";
import { TextPromptModal } from "./modals/textPrompt";
import type HomePagePlugin from "./main";
import type { SectionId } from "./settings";
import type { Priority, Task, Ticket } from "./types";

export const HOME_VIEW_TYPE = "hptp-home-view";

type Renderer = (parent: HTMLElement, ctx: SectionContext) => void;

const RENDERERS: Record<SectionId, Renderer> = {
	byDate: renderByDate,
	priorityBoard: renderPriorityBoard,
	tickets: renderTickets,
	dailyNotes: renderDailyNotes,
	stats: renderStats,
};

export class HomeView extends ItemView {
	private data: HomeData | null = null;
	private collapsed = new Set<string>();
	private expanded = new Set<string>();
	private loading = false;
	private quickAddValue = "";
	private quickAddFocused = false;
	private scrollTop = 0;
	/** The scrolling element, kept so the position can be restored onto it. */
	private pageEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: HomePagePlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return HOME_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Home";
	}

	getIcon(): string {
		return "home";
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("hptp-view-container");
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Rescan the vault and redraw. */
	async refresh(): Promise<void> {
		if (this.loading) return;
		this.loading = true;
		try {
			this.data = await this.plugin.loadHomeData();
			this.draw();
		} catch (err) {
			this.drawError(err);
		} finally {
			this.loading = false;
		}
	}

	/** Redraw from existing data, for pure UI state changes. */
	redraw(): void {
		if (this.data) this.draw();
	}

	/** Context handed to each section. */
	private context(): SectionContext {
		const data = this.data;
		if (!data) throw new Error("No data loaded.");

		return {
			app: this.app,
			plugin: this.plugin,
			data,
			settings: this.plugin.settings,

			refresh: () => void this.refresh(),
			redraw: () => this.redraw(),
			updateSettings: (patch) => {
				Object.assign(this.plugin.settings, patch);
				void this.plugin.saveSettings();
				this.plugin.redrawViews();
			},

			openPath: (path, line, newLeaf) =>
				this.openPath(path, line, newLeaf),

			toggleTask: (task) => this.runTaskAction(() =>
				this.plugin.tasks.toggleComplete(task),
			),
			setPriority: (task, priority) => this.runTaskAction(() =>
				this.plugin.tasks.setPriority(task, priority),
			),
			setDue: (task, due) => this.runTaskAction(() =>
				this.plugin.tasks.setDue(task, due),
			),
			setStatus: (task, status) => this.runTaskAction(() =>
				this.plugin.tasks.setStatus(task, status),
			),
			removeTask: (task) => this.confirmRemove(task),
			editTask: (task) => this.editTask(task),

			addTask: (options) => this.plugin.openAddTaskModal(options),

			isCollapsed: (key) => this.collapsed.has(key),
			setCollapsed: (key, collapsed) => {
				if (collapsed) this.collapsed.add(key);
				else this.collapsed.delete(key);
			},

			isExpanded: (key) => this.expanded.has(key),
			setExpanded: (key, expanded) => {
				if (expanded) this.expanded.add(key);
				else this.expanded.delete(key);
			},
		};
	}

	/** Run a write, then refresh. Stale writes refresh rather than shout. */
	private async runTaskAction(action: () => Promise<void>): Promise<void> {
		try {
			await action();
		} catch (err) {
			if (err instanceof StaleTaskError) {
				new Notice(err.message);
			} else {
				new Notice(
					`Could not update the task: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
		await this.refresh();
	}

	private async confirmRemove(task: Task): Promise<void> {
		await this.runTaskAction(() => this.plugin.tasks.remove(task));
	}

	private async editTask(task: Task): Promise<void> {
		new TextPromptModal(
			this.app,
			{
				title: "Edit task",
				description:
					"Only the text changes. Priority, dates and tags stay as they are.",
				initialValue: task.description,
				submitText: "Save",
			},
			async (value) => {
				await this.runTaskAction(() =>
					this.plugin.tasks.setDescription(task, value),
				);
			},
		).open();
	}

	/** Open a file, scrolling to a line when given one. */
	private async openPath(
		path: string,
		line?: number,
		newLeaf = false,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`Could not find ${path}.`);
			return;
		}

		const leaf = this.app.workspace.getLeaf(newLeaf ? "tab" : false);
		await leaf.openFile(file, {
			eState: line !== undefined ? { line } : undefined,
		});
	}

	/** Full redraw. */
	private draw(): void {
		const data = this.data;
		if (!data) return;

		this.rememberScroll();

		const root = this.contentEl;
		root.empty();
		root.addClass("hptp-root");

		const page = root.createDiv({ cls: "hptp-page" });
		this.pageEl = page;

		const ctx = this.context();
		this.drawHero(page, ctx);

		const columns = page.createDiv({ cls: "hptp-columns" });
		const left = columns.createDiv({ cls: "hptp-column hptp-column-main" });
		const right = columns.createDiv({ cls: "hptp-column hptp-column-side" });

		// Task-heavy sections go in the wide column, context in the narrow one.
		const mainSections: SectionId[] = ["byDate", "priorityBoard"];

		let rendered = 0;
		for (const section of this.plugin.settings.sections) {
			if (!section.enabled) continue;
			const target = mainSections.includes(section.id) ? left : right;
			try {
				RENDERERS[section.id](target, ctx);
				rendered++;
			} catch (err) {
				target.createDiv({
					cls: "hptp-error",
					text: `Could not render the ${section.id} section: ${
						err instanceof Error ? err.message : String(err)
					}`,
				});
			}
		}

		if (rendered === 0) {
			page.createDiv({
				cls: "hptp-empty",
				text: "Every section is hidden. Turn one back on in Settings → Home Page Tasks Plus.",
			});
		}

		if (!right.hasChildNodes()) right.addClass("hptp-column-empty");

		this.restoreScroll();
	}

	/** The greeting bar, summary pills and quick-add row. */
	private drawHero(parent: HTMLElement, ctx: SectionContext): void {
		const { stats } = ctx.data;
		const hero = parent.createDiv({ cls: "hptp-hero" });

		const top = hero.createDiv({ cls: "hptp-hero-top" });

		const titleWrap = top.createDiv({ cls: "hptp-hero-title" });
		titleWrap.createEl("h1", { text: greeting() });
		titleWrap.createDiv({
			cls: "hptp-hero-date",
			text: new Date().toLocaleDateString(undefined, {
				weekday: "long",
				month: "long",
				day: "numeric",
				year: "numeric",
			}),
		});

		const actions = top.createDiv({ cls: "hptp-hero-actions" });

		this.heroButton(actions, "plus", "Add task", () =>
			void ctx.addTask(),
		);
		this.heroButton(actions, "file-plus", "New daily note", () =>
			void this.plugin.openTodayNote(),
		);
		if (this.plugin.settings.aiEnabled) {
			this.heroButton(actions, "sparkles", "Summarise today", () =>
				void this.plugin.summariseToday(),
			);
		}
		this.heroButton(actions, "refresh-cw", "Refresh", () =>
			void this.refresh(),
		);

		// Summary pills.
		const pills = hero.createDiv({ cls: "hptp-pills" });
		this.pill(pills, `${stats.openTotal} open`, "neutral");
		if (stats.dueToday > 0) {
			this.pill(pills, `${stats.dueToday} due today`, "warn");
		}
		if (stats.overdue > 0) {
			this.pill(pills, `${stats.overdue} overdue`, "bad");
		}
		if (stats.completedToday > 0) {
			this.pill(pills, `${stats.completedToday} done today`, "good");
		}
		if (stats.overdue === 0 && stats.dueToday === 0) {
			this.pill(pills, "Nothing due today", "good");
		}

		this.drawQuickAdd(hero);
	}

	private heroButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): void {
		const button = parent.createEl("button", {
			cls: "hptp-hero-button",
			attr: { title: label, "aria-label": label },
		});
		setIcon(button.createSpan({ cls: "hptp-hero-button-icon" }), icon);
		button.createSpan({ text: label });
		button.addEventListener("click", onClick);
	}

	private pill(parent: HTMLElement, text: string, tone: string): void {
		parent.createSpan({ cls: `hptp-pill hptp-pill-${tone}`, text });
	}

	/** One-line task entry with shorthand parsing. */
	private drawQuickAdd(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "hptp-quick-add" });

		const iconEl = wrap.createSpan({ cls: "hptp-quick-add-icon" });
		setIcon(iconEl, "plus-circle");

		const input = wrap.createEl("input", {
			type: "text",
			cls: "hptp-quick-add-input",
			attr: {
				placeholder:
					"Add a task — try: Ship AS2 fix !1 @tomorrow #ticket/T3F-340",
				"aria-label": "Add a task",
			},
		});
		input.value = this.quickAddValue;

		const preview = wrap.createSpan({ cls: "hptp-quick-add-preview" });

		const updatePreview = () => {
			const parsed = parseEntry(input.value);
			const bits: string[] = [];
			if (parsed.priority) bits.push(parsed.priority);
			if (parsed.due) bits.push(parsed.due);
			preview.setText(bits.join(" · "));
		};

		input.addEventListener("input", () => {
			this.quickAddValue = input.value;
			updatePreview();
		});
		input.addEventListener("focus", () => {
			this.quickAddFocused = true;
		});
		input.addEventListener("blur", () => {
			this.quickAddFocused = false;
		});

		const submit = async () => {
			const raw = input.value;
			if (!raw.trim()) return;

			input.disabled = true;
			try {
				await this.plugin.quickAddTask(raw);
				this.quickAddValue = "";
				this.quickAddFocused = true;
			} finally {
				input.disabled = false;
			}
			await this.refresh();
		};

		input.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") {
				ev.preventDefault();
				void submit();
			} else if (ev.key === "Escape") {
				input.value = "";
				this.quickAddValue = "";
				updatePreview();
				input.blur();
			}
		});

		const button = wrap.createEl("button", {
			cls: "hptp-quick-add-button",
			text: "Add",
		});
		button.addEventListener("click", () => void submit());

		const expand = wrap.createEl("button", {
			cls: "hptp-icon-button",
			attr: { title: "More options", "aria-label": "More options" },
		});
		setIcon(expand, "settings-2");
		expand.addEventListener("click", () => {
			void this.plugin.openAddTaskModal({
				description: input.value,
			});
		});

		updatePreview();

		if (this.quickAddFocused) {
			window.setTimeout(() => {
				input.focus();
				input.setSelectionRange(
					input.value.length,
					input.value.length,
				);
			}, 0);
		}
	}

	private drawError(err: unknown): void {
		const root = this.contentEl;
		root.empty();
		const box = root.createDiv({ cls: "hptp-error" });
		box.createEl("h3", { text: "The home page could not be built" });
		box.createEl("p", {
			text: err instanceof Error ? err.message : String(err),
		});
		const retry = box.createEl("button", { text: "Try again" });
		retry.addEventListener("click", () => void this.refresh());
	}

	/** Focus the quick-add field, for the command and hotkey. */
	focusQuickAdd(): void {
		const input = this.contentEl.querySelector<HTMLInputElement>(
			".hptp-quick-add-input",
		);
		if (input) {
			input.focus();
			this.quickAddFocused = true;
		}
	}

	private rememberScroll(): void {
		this.scrollTop = this.pageEl?.scrollTop ?? 0;
	}

	/**
	 * Put the scroll position back on the element that actually scrolls.
	 * Layout has not settled when draw() finishes, so this is deferred a
	 * frame — otherwise the assignment lands on a zero-height element and is
	 * silently clamped to 0.
	 */
	private restoreScroll(): void {
		const target = this.pageEl;
		const top = this.scrollTop;
		if (!target || top <= 0) return;

		target.scrollTop = top;
		requestAnimationFrame(() => {
			if (target.isConnected && target.scrollTop !== top) {
				target.scrollTop = top;
			}
		});
	}
}

/** Re-exported so main.ts can build data without importing the view. */
export type { HomeData, Priority, Ticket };
export { buildHomeData, todayISO };
