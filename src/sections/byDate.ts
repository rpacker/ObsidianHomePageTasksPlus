/**
 * "Tasks by date": overdue, today, tomorrow, upcoming, undated.
 *
 * When task groups are defined the card holds one block per group, each with
 * its own date buckets. The toolbar at the top changes the sort order and
 * whether completed tasks are shown, for the whole card, without leaving the
 * page.
 */

import { Menu, setIcon } from "obsidian";
import { renderCard, renderEmpty } from "../ui/card";
import { renderTaskGroup } from "../ui/taskGroup";
import { renderTaskItem } from "../ui/taskItem";
import { bucketByDate, isClosed } from "../homeData";
import type { SectionContext } from "./context";
import { TASK_SORTS, type DateBucket, type Task, type TaskSort } from "../types";

interface DateGroup {
	bucket: DateBucket;
	title: string;
	icon: string;
	/** Collapse this group by default when it has items. */
	quiet?: boolean;
}

const DATE_GROUPS: DateGroup[] = [
	{ bucket: "overdue", title: "Overdue", icon: "alert-triangle" },
	{ bucket: "today", title: "Today", icon: "sun" },
	{ bucket: "tomorrow", title: "Tomorrow", icon: "sunrise" },
	{ bucket: "upcoming", title: "Upcoming", icon: "calendar-days" },
	{ bucket: "someday", title: "No date", icon: "inbox", quiet: true },
];

const SORT_LABELS: Record<TaskSort, string> = {
	"date-asc": "Date · earliest first",
	"date-desc": "Date · latest first",
	"priority-high": "Priority · highest first",
	"priority-low": "Priority · lowest first",
	"name-asc": "Name · A to Z",
	"name-desc": "Name · Z to A",
};

/** How many of a set of rows are live, and how many are closed. */
interface Tally {
	open: number;
	closed: number;
}

function tally(tasks: Task[]): Tally {
	const closed = tasks.filter(isClosed).length;
	return { open: tasks.length - closed, closed };
}

/** "7", or "7 open · 3 closed" once completed tasks are on show. */
function tallyLabel({ open, closed }: Tally): string {
	return closed > 0 ? `${open} open · ${closed} closed` : String(open);
}

export function renderByDate(parent: HTMLElement, ctx: SectionContext): void {
	const { groups, grouped, today } = ctx.data;
	const { byDateSort, byDateShowCompleted, upcomingDays } = ctx.settings;

	const blocks = groups.map((group) => {
		const buckets = bucketByDate(group.tasks, {
			showCompleted: byDateShowCompleted,
			upcomingDays,
			today,
			sort: byDateSort,
		});
		const rows = DATE_GROUPS.flatMap((g) => buckets[g.bucket]);
		return { group, buckets, rows: rows.length, tally: tally(rows) };
	});

	const open = blocks.reduce((sum, b) => sum + b.tally.open, 0);
	const rows = blocks.reduce((sum, b) => sum + b.rows, 0);

	const card = renderCard(parent, ctx, {
		title: "Tasks by date",
		icon: "list-checks",
		key: "section:byDate",
		badge: String(open),
		actions: [
			{
				icon: "plus",
				label: "Add a task",
				onClick: () => void ctx.addTask(),
			},
			{
				icon: "refresh-cw",
				label: "Refresh",
				onClick: () => ctx.refresh(),
			},
		],
	});

	if (card.collapsed) return;

	renderToolbar(card.body, ctx);

	if (rows === 0) {
		renderEmpty(
			card.body,
			byDateShowCompleted
				? "No tasks yet. Press the + above to add the first one."
				: "No open tasks. Press the + above to add the first one.",
		);
		return;
	}

	for (const block of blocks) {
		if (block.rows === 0) continue;

		const body = grouped
			? renderTaskGroup(card.body, ctx, block.group, {
					section: "byDate",
					count: tallyLabel(block.tally),
				})
			: card.body;
		if (!body) continue;

		for (const dateGroup of DATE_GROUPS) {
			const tasks = block.buckets[dateGroup.bucket];
			if (tasks.length === 0) continue;
			renderDateGroup(body, ctx, block.group.id, dateGroup, tasks);
		}
	}
}

/** The sort menu and the completed-tasks switch. */
function renderToolbar(parent: HTMLElement, ctx: SectionContext): void {
	const { byDateSort, byDateShowCompleted } = ctx.settings;
	const bar = parent.createDiv({ cls: "hptp-toolbar" });

	const sort = bar.createEl("button", {
		cls: "hptp-toolbar-button",
		attr: {
			title: "Change the sort order",
			"aria-label": `Sort order: ${SORT_LABELS[byDateSort]}. Click to change.`,
			"aria-haspopup": "menu",
		},
	});
	setIcon(sort.createSpan({ cls: "hptp-toolbar-icon" }), "arrow-up-down");
	sort.createSpan({ text: SORT_LABELS[byDateSort] });
	setIcon(sort.createSpan({ cls: "hptp-toolbar-icon" }), "chevron-down");

	sort.addEventListener("click", (ev) => {
		const menu = new Menu();
		TASK_SORTS.forEach((option, index) => {
			// The orders come in pairs: date, priority, name.
			if (index > 0 && index % 2 === 0) menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(SORT_LABELS[option])
					.setChecked(option === byDateSort)
					.onClick(() => ctx.updateSettings({ byDateSort: option })),
			);
		});
		menu.showAtMouseEvent(ev);
	});

	const completed = bar.createEl("label", {
		cls: "hptp-toolbar-toggle",
		attr: { title: "Show done and cancelled tasks, below the open ones" },
	});
	const checkbox = completed.createEl("input", { type: "checkbox" });
	checkbox.checked = byDateShowCompleted;
	completed.createSpan({ text: "Show completed" });
	checkbox.addEventListener("change", () => {
		ctx.updateSettings({ byDateShowCompleted: checkbox.checked });
	});
}

function renderDateGroup(
	parent: HTMLElement,
	ctx: SectionContext,
	groupId: string,
	group: DateGroup,
	tasks: Task[],
): void {
	const key = `group:byDate:${groupId}:${group.bucket}`;
	const wrapper = parent.createDiv({
		cls: `hptp-group hptp-group-${group.bucket}`,
	});

	const header = wrapper.createDiv({ cls: "hptp-group-header" });
	header.createSpan({ cls: "hptp-group-title", text: group.title });
	header.createSpan({
		cls: "hptp-group-count",
		text: tallyLabel(tally(tasks)),
	});

	const list = wrapper.createDiv({ cls: "hptp-task-list" });

	const limit = ctx.settings.maxPerGroup;
	const expanded = ctx.isExpanded(key);
	const shown = expanded ? tasks : tasks.slice(0, limit);

	for (const task of shown) {
		renderTaskItem(list, task, ctx, { draggable: true });
	}

	if (tasks.length > limit) {
		const more = wrapper.createEl("button", {
			cls: "hptp-show-more",
			text: expanded
				? "Show fewer"
				: `Show all ${tasks.length}`,
		});
		more.addEventListener("click", () => {
			ctx.setExpanded(key, !expanded);
			ctx.redraw();
		});
	}
}
