/**
 * "Priority board": one lane per priority, with drag and drop between lanes.
 *
 * Dropping a task onto a lane rewrites its priority emoji in the markdown, so
 * the board is a real editor rather than a read-only view.
 */

import { Notice, setIcon } from "obsidian";
import { renderCard, renderEmpty } from "../ui/card";
import { groupDragType, renderTaskGroup } from "../ui/taskGroup";
import { renderTaskItem } from "../ui/taskItem";
import { bucketByPriority } from "../homeData";
import { PRIORITY_EMOJI, PRIORITY_LABEL } from "../taskFormat";
import { PRIORITY_ORDER, type Priority, type Task } from "../types";
import type { SectionContext } from "./context";

export function renderPriorityBoard(
	parent: HTMLElement,
	ctx: SectionContext,
): void {
	const { groups, grouped } = ctx.data;

	// With task groups defined there is one board per group, stacked.
	const blocks = groups.map((group) => {
		const lanes = bucketByPriority(group.tasks, {
			showCompleted: !ctx.settings.hideCompleted,
		});
		const count = PRIORITY_ORDER.reduce(
			(sum, p) => sum + lanes[p].length,
			0,
		);
		return { group, lanes, count };
	});
	const total = blocks.reduce((sum, b) => sum + b.count, 0);

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
		text: grouped
			? "Drag a task into another lane of its group to change its priority."
			: "Drag a task into another lane to change its priority.",
	});

	for (const block of blocks) {
		if (block.count === 0) continue;

		const body = grouped
			? renderTaskGroup(card.body, ctx, block.group, {
					section: "board",
					count: String(block.count),
				})
			: card.body;
		if (!body) continue;

		const board = body.createDiv({ cls: "hptp-board" });
		for (const priority of PRIORITY_ORDER) {
			renderLane(
				board,
				ctx,
				block.group.id,
				priority,
				block.lanes[priority],
			);
		}
	}
}

function renderLane(
	board: HTMLElement,
	ctx: SectionContext,
	groupId: string,
	priority: Priority,
	tasks: Task[],
): void {
	// A task's group follows the folder it is filed in, so a lane only takes
	// tasks from its own group: dropping across groups could not move one.
	const groupType = groupDragType(groupId);
	const accepts = (ev: DragEvent): boolean => {
		const types = ev.dataTransfer?.types;
		return (
			!!types &&
			types.includes("text/hptp-task") &&
			types.includes(groupType)
		);
	};

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
	const key = `group:board:${groupId}:${priority}`;
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
		if (!accepts(ev)) return;
		ev.preventDefault();
		if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
	});

	lane.addEventListener("dragenter", (ev) => {
		if (!accepts(ev)) return;
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

		if (!accepts(ev)) return;
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
