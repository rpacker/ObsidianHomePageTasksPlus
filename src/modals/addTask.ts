/** The full "add task" dialog. */

import { App, Modal, Notice, Setting } from "obsidian";
import { addDays, todayISO } from "../dates";
import { PRIORITY_LABEL } from "../taskFormat";
import { parseEntry } from "../quickParse";
import { PRIORITY_ORDER, type Priority, type Ticket } from "../types";

export interface AddTaskResult {
	description: string;
	priority: Priority;
	due: string | null;
	scheduled: string | null;
	targetPath: string;
}

export interface AddTaskOptions {
	/** Path of the inbox file, offered as the default target. */
	inboxPath: string;
	/** Path of today's daily note (may not exist yet). */
	dailyNotePath: string;
	/** Tickets offered as targets. */
	tickets: Ticket[];
	/** Pre-selected target path, e.g. when adding from a ticket card. */
	initialTarget?: string;
	/** Pre-filled description. */
	initialDescription?: string;
	/** Pre-selected due date. */
	initialDue?: string | null;
	/** Pre-selected priority. */
	initialPriority?: Priority;
}

export class AddTaskModal extends Modal {
	private description: string;
	private priority: Priority;
	private due: string | null;
	private scheduled: string | null = null;
	private targetPath: string;
	private submitted = false;

	constructor(
		app: App,
		private options: AddTaskOptions,
		private onSubmit: (result: AddTaskResult) => void | Promise<void>,
	) {
		super(app);
		this.description = options.initialDescription ?? "";
		this.priority = options.initialPriority ?? "normal";
		this.due = options.initialDue ?? null;
		this.targetPath = options.initialTarget ?? options.inboxPath;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("hptp-add-task-modal");

		contentEl.createEl("h2", { text: "Add task" });

		// Description, with shorthand parsed as you type.
		const descSetting = new Setting(contentEl)
			.setName("Task")
			.setDesc(
				"Shorthand works here too: !1–!5 for priority, @today or @fri for a due date.",
			);

		const input = descSetting.controlEl.createEl("input", {
			type: "text",
			cls: "hptp-add-task-input",
			attr: { placeholder: "What needs doing?" },
		});
		input.value = this.description;

		const hint = contentEl.createDiv({ cls: "hptp-add-task-hint" });

		const refreshHint = () => {
			const parsed = parseEntry(input.value);
			const bits: string[] = [];
			if (parsed.priority) {
				bits.push(`priority ${PRIORITY_LABEL[parsed.priority]}`);
			}
			if (parsed.due) bits.push(`due ${parsed.due}`);
			hint.setText(bits.length ? `Shorthand: ${bits.join(" · ")}` : "");
		};

		input.addEventListener("input", refreshHint);
		input.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") {
				ev.preventDefault();
				void this.submit(input.value);
			}
		});
		refreshHint();

		// Priority.
		new Setting(contentEl).setName("Priority").addDropdown((d) => {
			for (const p of PRIORITY_ORDER) d.addOption(p, PRIORITY_LABEL[p]);
			d.setValue(this.priority).onChange((v) => {
				this.priority = v as Priority;
			});
		});

		// Due date, with quick buttons.
		const dueSetting = new Setting(contentEl).setName("Due date");
		const dueInput = dueSetting.controlEl.createEl("input", {
			type: "date",
			cls: "hptp-date-input",
		});
		dueInput.value = this.due ?? "";
		dueInput.addEventListener("change", () => {
			this.due = dueInput.value || null;
		});

		const quick = contentEl.createDiv({ cls: "hptp-quick-dates" });
		const quickOptions: { label: string; value: string | null }[] = [
			{ label: "Today", value: todayISO() },
			{ label: "Tomorrow", value: addDays(todayISO(), 1) },
			{ label: "In 3 days", value: addDays(todayISO(), 3) },
			{ label: "Next week", value: addDays(todayISO(), 7) },
			{ label: "None", value: null },
		];
		for (const option of quickOptions) {
			const button = quick.createEl("button", {
				text: option.label,
				cls: "hptp-chip-button",
			});
			button.addEventListener("click", (ev) => {
				ev.preventDefault();
				this.due = option.value;
				dueInput.value = option.value ?? "";
			});
		}

		// Scheduled date.
		const schedSetting = new Setting(contentEl)
			.setName("Scheduled")
			.setDesc("Optional — when you plan to start it.");
		const schedInput = schedSetting.controlEl.createEl("input", {
			type: "date",
			cls: "hptp-date-input",
		});
		schedInput.addEventListener("change", () => {
			this.scheduled = schedInput.value || null;
		});

		// Target file.
		new Setting(contentEl)
			.setName("Add to")
			.setDesc("Which file the task line is appended to.")
			.addDropdown((d) => {
				d.addOption(this.options.inboxPath, `Inbox — ${this.options.inboxPath}`);
				d.addOption(
					this.options.dailyNotePath,
					`Today's daily note — ${this.options.dailyNotePath}`,
				);
				for (const ticket of this.options.tickets) {
					d.addOption(
						ticket.notePath,
						`${ticket.key}${
							ticket.title && ticket.title !== ticket.key
								? ` — ${ticket.title}`
								: ""
						}`,
					);
				}
				d.setValue(this.targetPath).onChange((v) => {
					this.targetPath = v;
				});
			});

		// Buttons.
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Add task")
					.setCta()
					.onClick(() => void this.submit(input.value)),
			)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => this.close()),
			);

		window.setTimeout(() => input.focus(), 0);
	}

	private async submit(rawInput: string): Promise<void> {
		if (this.submitted) return;

		const parsed = parseEntry(rawInput);
		if (!parsed.description) {
			new Notice("Give the task some text first.");
			return;
		}

		this.submitted = true;
		const result: AddTaskResult = {
			description: parsed.description,
			priority: parsed.priority ?? this.priority,
			due: parsed.due ?? this.due,
			scheduled: this.scheduled,
			targetPath: this.targetPath,
		};

		this.close();
		await this.onSubmit(result);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
