/**
 * The block a task section draws for each task group.
 *
 * Shared by "Tasks by date" and the priority board so a group reads the same
 * in both: a header naming the group and its folders, then the section's own
 * content underneath. Clicking the header folds the block away.
 */

import { setIcon } from "obsidian";
import { folderDisplayName, type TaskGroup } from "../groups";
import type { SectionContext } from "../sections/context";

export interface TaskGroupBlockOptions {
	/** Which section is drawing the block; keeps the folded state separate. */
	section: string;
	/** Count shown beside the group's name. */
	count: string;
}

/** MIME type a dragged task carries to say which group it belongs to. */
export function groupDragType(groupId: string): string {
	return `text/hptp-group-${groupId}`;
}

/**
 * Draw a group block and return the element to fill, or null when the block
 * is folded and has no body to draw into.
 */
export function renderTaskGroup(
	parent: HTMLElement,
	ctx: SectionContext,
	group: TaskGroup,
	options: TaskGroupBlockOptions,
): HTMLElement | null {
	const key = `taskGroup:${options.section}:${group.id}`;
	const collapsed = ctx.isCollapsed(key);

	const root = parent.createDiv({
		cls: `hptp-taskgroup hptp-taskgroup-${group.id}`,
	});
	if (collapsed) root.addClass("hptp-taskgroup-collapsed");

	const header = root.createDiv({ cls: "hptp-taskgroup-header" });
	header.setAttribute("role", "button");
	header.setAttribute("tabindex", "0");
	header.setAttribute(
		"aria-label",
		`${collapsed ? "Expand" : "Collapse"} ${group.name}`,
	);
	header.setAttribute("aria-expanded", String(!collapsed));

	const chevron = header.createSpan({ cls: "hptp-taskgroup-chevron" });
	setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");

	header.createSpan({ cls: "hptp-taskgroup-dot" });
	header.createSpan({ cls: "hptp-taskgroup-name", text: group.name });
	header.createSpan({ cls: "hptp-taskgroup-count", text: options.count });

	if (group.folders.length > 0) {
		const folders = group.folders.map(folderDisplayName).join(" · ");
		const foldersEl = header.createSpan({
			cls: "hptp-taskgroup-folders",
			text: folders,
		});
		foldersEl.setAttribute("title", folders);
	}

	// The body is only drawn while the block is open, so the toggle redraws
	// rather than flipping a class over content that may not be there.
	const toggle = () => {
		ctx.setCollapsed(key, !collapsed);
		ctx.redraw();
	};

	header.addEventListener("click", toggle);
	header.addEventListener("keydown", (ev) => {
		if (ev.key === "Enter" || ev.key === " ") {
			ev.preventDefault();
			toggle();
		}
	});

	if (collapsed) return null;
	return root.createDiv({ cls: "hptp-taskgroup-body" });
}
