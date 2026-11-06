/**
 * "Priority board": one lane per priority, with drag and drop between lanes.
 *
 * Dropping a task onto a lane rewrites its priority emoji in the markdown, so
 * the board is a real editor rather than a read-only view.
 */

import { Notice, setIcon } from "obsidian";
import { renderCard, renderEmpty } from "../ui/card";
import { renderTaskItem } from "../ui/taskItem";
import { PRIORITY_EMOJI, PRIORITY_LABEL } from "../taskFormat";
import { PRIORITY_ORDER, type Priority } from "../types";
import type { SectionContext } from "./context";

export function renderPriorityBoard(
	parent: HTMLElement,
	ctx: SectionContext,
): void {
	const { byPriority } = ctx.data;
	const total = PRIORITY_ORDER.reduce(
		(sum, p) => sum + byPriority[p].length,
		0,
	);

	const card = renderCard(parent, ctx, {
		title: "Priority board",
		icon: "flag",
		key: "section:priorityBoard",
		badge: String(total),
		actions: [
			{
				icon: "plus",
				label: "Add a task",
				onClick: () => void ctx.addTask(),
			},
		],
	});

	if (card.collapsed) return;

	if (total === 0) {
		renderEmpty(card.body, "No open tasks to prioritise.");
		return;
	}

	card.body.createDiv({
		cls: "hptp-board-hint",
		text: "Drag a task into another lane to change its priority.",
	});

	const board = card.body.createDiv({ cls: "hptp-board" });

	for (const priority of PRIORITY_ORDER) {
		renderLane(board, ctx, priority);
	}
}

function renderLane(
	board: HTMLElement,
	ctx: SectionContext,
	priority: Priority,
): void {
	const tasks = ctx.data.byPriority[priority];
	const lane = board.createDiv({
		cls: `hptp-lane hptp-lane-${priority}`,
	});

	const header = lane.createDiv({ cls: "hptp-lane-header" });
	if (PRIORITY_EMOJI[priority]) {
		header.createSpan({
			cls: "hptp-lane-emoji",
			text: PRIORITY_EMOJI[priority],
		});
	}
	header.createSpan({
		cls: "hptp-lane-title",
		text: PRIORITY_LABEL[priority],
	});
	header.createSpan({
		cls: "hptp-lane-count",
		text: String(tasks.length),
	});

	const addButton = header.createEl("button", {
		cls: "hptp-icon-button hptp-lane-add",
		attr: {
			"aria-label": `Add a ${PRIORITY_LABEL[priority]} priority task`,
			title: `Add a ${PRIORITY_LABEL[priority]} priority task`,
		},
	});
	setIcon(addButton, "plus");
	addButton.addEventListener("click", (ev) => {
		ev.stopPropagation();
		void ctx.addTask();
	});

	const list = lane.createDiv({ cls: "hptp-lane-body" });

	if (tasks.length === 0) {
		list.createDiv({ cls: "hptp-lane-empty", text: "Drop here" });
	}

	const limit = Math.max(5, Math.floor(ctx.settings.maxPerGroup / 2));
	const key = `group:board:${priority}`;
	const expanded = ctx.isExpanded(key);
	const shown = expanded ? tasks : tasks.slice(0, limit);

	for (const task of shown) {
		renderTaskItem(list, task, ctx, {
			draggable: true,
			showPriority: false,
		});
	}

	if (tasks.length > limit) {
		const more = lane.createEl("button", {
			cls: "hptp-show-more",
			text: expanded ? "Show fewer" : `Show all ${tasks.length}`,
		});
		more.addEventListener("click", () => {
			ctx.setExpanded(key, !expanded);
			ctx.redraw();
		});
	}

	// Drop target wiring. `dragenter`/`dragleave` can fire for child
	// elements, so a depth counter keeps the highlight stable.
	let depth = 0;

	lane.addEventListener("dragover", (ev) => {
		if (!ev.dataTransfer?.types.includes("text/hptp-task")) return;
		ev.preventDefault();
		ev.dataTransfer.dropEffect = "move";
	});

	lane.addEventListener("dragenter", (ev) => {
		if (!ev.dataTransfer?.types.includes("text/hptp-task")) return;
		depth++;
		lane.addClass("hptp-lane-dragover");
	});

	lane.addEventListener("dragleave", () => {
		depth = Math.max(0, depth - 1);
		if (depth === 0) lane.removeClass("hptp-lane-dragover");
	});

	lane.addEventListener("drop", (ev) => {
		ev.preventDefault();
		depth = 0;
		lane.removeClass("hptp-lane-dragover");

		const id = ev.dataTransfer?.getData("text/hptp-task");
		if (!id) return;

		const task = ctx.data.tasks.find((t) => t.id === id);
		if (!task) {
			new Notice("That task is no longer where it was. Refreshing.");
			ctx.refresh();
			return;
		}
		if (task.priority === priority) return;

		void ctx.setPriority(task, priority);
	});
}
