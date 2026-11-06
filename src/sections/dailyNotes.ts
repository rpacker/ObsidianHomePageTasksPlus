/** "Recent daily notes": the last N notes, newest first. */

import { setIcon } from "obsidian";
import { renderCard, renderEmpty } from "../ui/card";
import { fullLabel, relativeLabel } from "../dates";
import type { SectionContext } from "./context";

export function renderDailyNotes(
	parent: HTMLElement,
	ctx: SectionContext,
): void {
	const notes = ctx.data.dailyNotes;
	const todayNote = notes.find((n) => n.date === ctx.data.today);

	const card = renderCard(parent, ctx, {
		title: "Recent daily notes",
		icon: "calendar-check",
		key: "section:dailyNotes",
		badge: String(notes.length),
		actions: [
			{
				icon: "file-plus",
				label: todayNote
					? "Open today's daily note"
					: "Create today's daily note",
				onClick: () => void ctx.plugin.openTodayNote(),
			},
			{
				icon: "sparkles",
				label: "Summarise today into the daily note",
				onClick: () => void ctx.plugin.summariseToday(),
			},
		],
	});

	if (card.collapsed) return;

	if (notes.length === 0) {
		renderEmpty(
			card.body,
			`No daily notes found in "${ctx.settings.dailyNoteFolder}" matching the format "${ctx.settings.dailyNoteFormat}". Check the daily note settings, or use Import from Periodic Notes.`,
		);
		return;
	}

	const list = card.body.createDiv({ cls: "hptp-note-list" });

	for (const note of notes) {
		const row = list.createDiv({ cls: "hptp-note" });
		if (note.date === ctx.data.today) row.addClass("hptp-note-today");

		const dateEl = row.createDiv({ cls: "hptp-note-date" });
		dateEl.createSpan({
			cls: "hptp-note-relative",
			text: relativeLabel(note.date, ctx.data.today),
		});
		dateEl.createSpan({ cls: "hptp-note-name", text: note.basename });

		const preview = row.createDiv({ cls: "hptp-note-preview" });
		preview.setText(note.preview || "Empty note");
		if (!note.preview) preview.addClass("hptp-note-empty");

		row.setAttribute("title", `${fullLabel(note.date)} · ${note.path}`);
		row.addEventListener("click", () => void ctx.openPath(note.path));

		const openButton = row.createDiv({ cls: "hptp-note-open" });
		setIcon(openButton, "chevron-right");
	}

	if (!todayNote) {
		const create = card.body.createEl("button", {
			cls: "hptp-show-more",
			text: "Create today's daily note",
		});
		create.addEventListener("click", () => void ctx.plugin.openTodayNote());
	}
}
