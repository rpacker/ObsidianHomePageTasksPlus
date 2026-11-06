/** A one-field prompt, used for creating a ticket by key. */

import { App, Modal, Notice, Setting } from "obsidian";

export interface TextPromptOptions {
	title: string;
	description?: string;
	placeholder?: string;
	initialValue?: string;
	submitText?: string;
	/** Return an error message to reject the value, or null to accept it. */
	validate?: (value: string) => string | null;
}

export class TextPromptModal extends Modal {
	private value: string;

	constructor(
		app: App,
		private options: TextPromptOptions,
		private onSubmit: (value: string) => void | Promise<void>,
	) {
		super(app);
		this.value = options.initialValue ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.options.title });

		if (this.options.description) {
			contentEl.createEl("p", {
				cls: "hptp-settings-hint",
				text: this.options.description,
			});
		}

		const input = contentEl.createEl("input", {
			type: "text",
			cls: "hptp-add-task-input",
			attr: { placeholder: this.options.placeholder ?? "" },
		});
		input.value = this.value;

		input.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") {
				ev.preventDefault();
				void this.submit(input.value);
			}
		});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText(this.options.submitText ?? "Create")
					.setCta()
					.onClick(() => void this.submit(input.value)),
			)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => this.close()),
			);

		window.setTimeout(() => input.focus(), 0);
	}

	private async submit(raw: string): Promise<void> {
		const value = raw.trim();
		if (!value) {
			new Notice("Enter a value first.");
			return;
		}
		const error = this.options.validate?.(value);
		if (error) {
			new Notice(error);
			return;
		}
		this.close();
		await this.onSubmit(value);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
