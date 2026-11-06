/** "Tasks by date": overdue, today, tomorrow, upcoming, undated. */

import { renderCard, renderEmpty } from "../ui/card";
import { renderTaskItem } from "../ui/taskItem";
import type { SectionContext } from "./context";
import type { DateBucket, Task } from "../types";

interface Group {
	bucket: DateBucket;
	title: string;
	icon: string;
	/** Collapse this group by default when it has items. */
	quiet?: boolean;
}

const GROUPS: Group[] = [
	{ bucket: "overdue", title: "Overdue", icon: "alert-triangle" },
	{ bucket: "today", title: "Today", icon: "sun" },
	{ bucket: "tomorrow", title: "Tomorrow", icon: "sunrise" },
	{ bucket: "upcoming", title: "Upcoming", icon: "calendar-days" },
	{ bucket: "someday", title: "No date", icon: "inbox", quiet: true },
];

export function renderByDate(parent: HTMLElement, ctx: SectionContext): void {
	const { buckets } = ctx.data;
	const total = GROUPS.reduce(
		(sum, g) => sum + buckets[g.bucket].length,
		0,
	);

	const card = renderCard(parent, ctx, {
		title: "Tasks by date",
		icon: "list-checks",
		key: "section:byDate",
		badge: String(total),
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

	if (total === 0) {
		renderEmpty(
			card.body,
			"No open tasks. Press the + above to add the first one.",
		);
		return;
	}

	for (const group of GROUPS) {
		const tasks = buckets[group.bucket];
		if (tasks.length === 0) continue;
		renderGroup(card.body, ctx, group, tasks);
	}
}

function renderGroup(
	parent: HTMLElement,
	ctx: SectionContext,
	group: Group,
	tasks: Task[],
): void {
	const key = `group:byDate:${group.bucket}`;
	const wrapper = parent.createDiv({
		cls: `hptp-group hptp-group-${group.bucket}`,
	});

	const header = wrapper.createDiv({ cls: "hptp-group-header" });
	header.createSpan({ cls: "hptp-group-title", text: group.title });
	header.createSpan({ cls: "hptp-group-count", text: String(tasks.length) });

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
