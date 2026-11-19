/**
 * Renders one task row.
 *
 * Shared by the date section and the priority board so a task looks and
 * behaves the same wherever it appears. Rows are draggable; the board is
 * what listens for the drop.
 */

import { Menu, Notice, setIcon } from "obsidian";
import { addDays, fullLabel, relativeLabel, todayISO } from "../dates";
import { displayText, PRIORITY_EMOJI, PRIORITY_LABEL } from "../taskFormat";
import { groupIdForPath } from "../groups";
import { effectiveDate } from "../homeData";
import { PRIORITY_ORDER, type Priority, type Task } from "../types";
import type { SectionContext } from "../sections/context";
import { groupDragType } from "./taskGroup";

export interface TaskItemOptions {
	/** Show which file the task came from. */
	showSource?: boolean;
	/** Show the priority badge (hidden on the board, where the lane says it). */
	showPriority?: boolean;
	/** Make the row draggable. */
	draggable?: boolean;
}

/** Append a task row to `parent`. */
export function renderTaskItem(
	parent: HTMLElement,
	task: Task,
	ctx: SectionContext,
	options: TaskItemOptions = {},
): HTMLElement {
	const {
		showSource = true,
		showPriority = true,
		draggable = false,
	} = options;

	const row = parent.createDiv({ cls: "hptp-task" });
	row.addClass(`hptp-priority-${task.priority}`);
	row.dataset.taskId = task.id;

	if (task.status === "done") row.addClass("hptp-task-done");
	if (task.status === "cancelled") row.addClass("hptp-task-cancelled");
	if (task.status === "inProgress") row.addClass("hptp-task-progress");

	const date = effectiveDate(task);
	const today = ctx.data.today;
	if (date && date < today && task.status !== "done") {
		row.addClass("hptp-task-overdue");
	}

	if (draggable) {
		row.draggable = true;
		row.addEventListener("dragstart", (ev) => {
			row.addClass("hptp-dragging");
			ev.dataTransfer?.setData("text/hptp-task", task.id);
			// Drop targets can read a drag's types but not its data until
			// the drop, so the task's group travels as a type of its own.
			ev.dataTransfer?.setData(
				groupDragType(
					groupIdForPath(ctx.settings.taskGroups, task.path),
				),
				"1",
			);
			ev.dataTransfer?.setData("text/plain", task.description);
			if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
		});
		row.addEventListener("dragend", () => row.removeClass("hptp-dragging"));
	}

	// Checkbox.
	const checkbox = row.createEl("input", {
		type: "checkbox",
		cls: "hptp-task-checkbox",
	});
	checkbox.checked = task.status === "done";
	checkbox.setAttribute(
		"aria-label",
		task.status === "done" ? "Mark as not done" : "Mark as done",
	);
	checkbox.addEventListener("click", async (ev) => {
		ev.stopPropagation();
		checkbox.disabled = true;
		await ctx.toggleTask(task);
	});

	// Body: text plus the metadata chips underneath.
	const body = row.createDiv({ cls: "hptp-task-body" });

	const textEl = body.createDiv({ cls: "hptp-task-text" });
	const text = displayText(task.description);
	textEl.setText(text || "(empty task)");
	textEl.setAttribute("title", "Click to open · double-click to edit the text");

	textEl.addEventListener("click", (ev) => {
		ev.stopPropagation();
		void ctx.openPath(task.path, task.line);
	});
	textEl.addEventListener("dblclick", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		void ctx.editTask(task);
	});

	const meta = body.createDiv({ cls: "hptp-task-meta" });

	if (showPriority && task.priority !== "normal") {
		const badge = meta.createSpan({
			cls: `hptp-chip hptp-chip-priority hptp-chip-${task.priority}`,
		});
		badge.setText(
			`${PRIORITY_EMOJI[task.priority]} ${PRIORITY_LABEL[task.priority]}`,
		);
		badge.setAttribute("title", "Click to change priority");
		badge.addEventListener("click", (ev) => {
			ev.stopPropagation();
			showPriorityMenu(ev, task, ctx);
		});
	}

	if (date) {
		const chip = meta.createSpan({ cls: "hptp-chip hptp-chip-date" });
		if (date < today && task.status !== "done") {
			chip.addClass("hptp-chip-overdue");
		} else if (date === today) {
			chip.addClass("hptp-chip-today");
		}
		setIcon(chip.createSpan({ cls: "hptp-chip-icon" }), "calendar");
		chip.createSpan({ text: relativeLabel(date, today) });
		chip.setAttribute(
			"title",
			`${task.due ? "Due" : task.scheduled ? "Scheduled" : "Starts"} ${fullLabel(date)} · click to change`,
		);
		chip.addEventListener("click", (ev) => {
			ev.stopPropagation();
			showDateMenu(ev, task, ctx);
		});
	} else {
		const chip = meta.createSpan({
			cls: "hptp-chip hptp-chip-date hptp-chip-nodate",
		});
		setIcon(chip.createSpan({ cls: "hptp-chip-icon" }), "calendar-plus");
		chip.createSpan({ text: "No date" });
		chip.setAttribute("title", "Click to set a due date");
		chip.addEventListener("click", (ev) => {
			ev.stopPropagation();
			showDateMenu(ev, task, ctx);
		});
	}

	if (task.ticket) {
		const chip = meta.createSpan({
			cls: "hptp-chip hptp-chip-ticket",
			text: task.ticket,
		});
		chip.setAttribute("title", `Open ticket ${task.ticket}`);
		chip.addEventListener("click", (ev) => {
			ev.stopPropagation();
			const ticket = ctx.data.tickets.find(
				(t) => t.key.toLowerCase() === task.ticket?.toLowerCase(),
			);
			if (ticket) void ctx.openPath(ticket.notePath);
			else new Notice(`No note found for ${task.ticket}.`);
		});
	}

	for (const tag of task.tags) {
		if (tag.toLowerCase().startsWith("ticket/")) continue;
		meta.createSpan({ cls: "hptp-chip hptp-chip-tag", text: `#${tag}` });
	}

	if (showSource) {
		const source = meta.createSpan({
			cls: "hptp-chip hptp-chip-source",
			text: sourceLabel(task.path),
		});
		source.setAttribute("title", task.path);
		source.addEventListener("click", (ev) => {
			ev.stopPropagation();
			void ctx.openPath(task.path, task.line);
		});
	}

	// Overflow menu.
	const more = row.createDiv({ cls: "hptp-task-more" });
	setIcon(more, "more-vertical");
	more.setAttribute("aria-label", "Task options");
	more.addEventListener("click", (ev) => {
		ev.stopPropagation();
		showTaskMenu(ev, task, ctx);
	});

	row.addEventListener("contextmenu", (ev) => {
		ev.preventDefault();
		showTaskMenu(ev, task, ctx);
	});

	return row;
}

/** Short, readable label for a task's source file. */
export function sourceLabel(path: string): string {
	const parts = path.split("/");
	const file = parts[parts.length - 1].replace(/\.md$/, "");
	if (parts.length === 1) return file;
	return `${parts[parts.length - 2]}/${file}`;
}

function showPriorityMenu(
	ev: MouseEvent,
	task: Task,
	ctx: SectionContext,
): void {
	const menu = new Menu();
	for (const priority of PRIORITY_ORDER) {
		menu.addItem((item) => {
			item
				.setTitle(
					`${PRIORITY_EMOJI[priority] || "➖"} ${PRIORITY_LABEL[priority]}`,
				)
				.setChecked(task.priority === priority)
				.onClick(() => void ctx.setPriority(task, priority));
		});
	}
	menu.showAtMouseEvent(ev);
}

function showDateMenu(ev: MouseEvent, task: Task, ctx: SectionContext): void {
	const today = todayISO();
	const menu = new Menu();

	const options: { label: string; value: string | null }[] = [
		{ label: "Today", value: today },
		{ label: "Tomorrow", value: addDays(today, 1) },
		{ label: "In 3 days", value: addDays(today, 3) },
		{ label: "Next week", value: addDays(today, 7) },
		{ label: "In two weeks", value: addDays(today, 14) },
	];

	for (const option of options) {
		menu.addItem((item) =>
			item
				.setTitle(option.label)
				.setChecked(task.due === option.value)
				.onClick(() => void ctx.setDue(task, option.value)),
		);
	}

	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle("Clear due date")
			.setIcon("x")
			.setDisabled(!task.due)
			.onClick(() => void ctx.setDue(task, null)),
	);

	menu.showAtMouseEvent(ev);
}

function showTaskMenu(ev: MouseEvent, task: Task, ctx: SectionContext): void {
	const menu = new Menu();

	menu.addItem((item) =>
		item
			.setTitle(task.status === "done" ? "Mark as not done" : "Mark as done")
			.setIcon(task.status === "done" ? "rotate-ccw" : "check")
			.onClick(() => void ctx.toggleTask(task)),
	);

	menu.addItem((item) =>
		item
			.setTitle("Mark as in progress")
			.setIcon("loader")
			.setChecked(task.status === "inProgress")
			.onClick(() => void ctx.setStatus(task, "inProgress")),
	);

	menu.addItem((item) =>
		item
			.setTitle("Mark as cancelled")
			.setIcon("ban")
			.setChecked(task.status === "cancelled")
			.onClick(() => void ctx.setStatus(task, "cancelled")),
	);

	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Edit text…")
			.setIcon("pencil")
			.onClick(() => void ctx.editTask(task)),
	);

	menu.addItem((item) => {
		item.setTitle("Priority").setIcon("flag");
		const sub = (
			item as unknown as { setSubmenu: () => Menu }
		).setSubmenu?.();
		if (sub) {
			for (const priority of PRIORITY_ORDER) {
				sub.addItem((subItem) =>
					subItem
						.setTitle(
							`${PRIORITY_EMOJI[priority] || "➖"} ${PRIORITY_LABEL[priority]}`,
						)
						.setChecked(task.priority === priority)
						.onClick(() => void ctx.setPriority(task, priority)),
				);
			}
		} else {
			// Older Obsidian builds have no submenus: fall back to a cycle.
			item.onClick(() => {
				const next =
					PRIORITY_ORDER[
						(PRIORITY_ORDER.indexOf(task.priority) + 1) %
							PRIORITY_ORDER.length
					];
				void ctx.setPriority(task, next);
			});
		}
	});

	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Open in current tab")
			.setIcon("file-text")
			.onClick(() => void ctx.openPath(task.path, task.line)),
	);

	menu.addItem((item) =>
		item
			.setTitle("Open in new tab")
			.setIcon("external-link")
			.onClick(() => void ctx.openPath(task.path, task.line, true)),
	);

	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Delete task")
			.setIcon("trash-2")
			.onClick(() => void ctx.removeTask(task)),
	);

	menu.showAtMouseEvent(ev);
}
