/** "Active tickets": one card per ticket, with its open task count. */

import { setIcon } from "obsidian";
import { renderCard, renderEmpty } from "../ui/card";
import { renderTaskItem } from "../ui/taskItem";
import { relativeLabel } from "../dates";
import { PRIORITY_EMOJI, PRIORITY_LABEL } from "../taskFormat";
import { isClosed } from "../homeData";
import type { SectionContext } from "./context";
import type { Ticket } from "../types";

export function renderTickets(parent: HTMLElement, ctx: SectionContext): void {
	const tickets = ctx.data.tickets;
	const withOpen = tickets.filter((t) =>
		t.tasks.some((task) => !isClosed(task)),
	);

	const card = renderCard(parent, ctx, {
		title: "Active tickets",
		icon: "ticket",
		key: "section:tickets",
		badge: `${withOpen.length}/${tickets.length}`,
		actions: [
			{
				icon: "folder-plus",
				label: "New ticket",
				onClick: () => void ctx.plugin.promptNewTicket(),
			},
			{
				icon: "folder-open",
				label: "Open the ticket folder",
				onClick: () => void ctx.plugin.revealTicketFolder(),
			},
		],
	});

	if (card.collapsed) return;

	if (tickets.length === 0) {
		renderEmpty(
			card.body,
			`No tickets found in "${ctx.settings.ticketFolder}". Both "${ctx.settings.ticketFolder}/KEY.md" and "${ctx.settings.ticketFolder}/KEY/KEY.md" are detected.`,
		);
		return;
	}

	const list = card.body.createDiv({ cls: "hptp-ticket-grid" });

	// Tickets with open work first; the rest are available behind a toggle.
	const quiet = tickets.filter(
		(t) => !t.tasks.some((task) => !isClosed(task)),
	);

	for (const ticket of withOpen) renderTicketCard(list, ctx, ticket);

	if (quiet.length === 0) return;

	const key = "group:tickets:quiet";
	const expanded = ctx.isExpanded(key);

	if (expanded) {
		for (const ticket of quiet) renderTicketCard(list, ctx, ticket);
	}

	const more = card.body.createEl("button", {
		cls: "hptp-show-more",
		text: expanded
			? "Hide tickets with no open tasks"
			: `Show ${quiet.length} ticket${quiet.length === 1 ? "" : "s"} with no open tasks`,
	});
	more.addEventListener("click", () => {
		ctx.setExpanded(key, !expanded);
		ctx.redraw();
	});
}

function renderTicketCard(
	parent: HTMLElement,
	ctx: SectionContext,
	ticket: Ticket,
): void {
	const open = ticket.tasks.filter((t) => !isClosed(t));
	const done = ticket.tasks.length - open.length;

	const el = parent.createDiv({ cls: "hptp-ticket" });
	if (open.length === 0) el.addClass("hptp-ticket-quiet");
	if (ticket.priority) el.addClass(`hptp-priority-${ticket.priority}`);

	const header = el.createDiv({ cls: "hptp-ticket-header" });

	const keyEl = header.createDiv({ cls: "hptp-ticket-key" });
	setIcon(keyEl.createSpan({ cls: "hptp-ticket-icon" }), ticket.folderPath ? "folder" : "file-text");
	keyEl.createSpan({ text: ticket.key });
	keyEl.setAttribute("title", `Open ${ticket.notePath}`);
	keyEl.addEventListener("click", () => void ctx.openPath(ticket.notePath));

	const actions = header.createDiv({ cls: "hptp-ticket-actions" });
	const addButton = actions.createEl("button", {
		cls: "hptp-icon-button",
		attr: {
			"aria-label": `Add a task to ${ticket.key}`,
			title: `Add a task to ${ticket.key}`,
		},
	});
	setIcon(addButton, "plus");
	addButton.addEventListener("click", (ev) => {
		ev.stopPropagation();
		void ctx.addTask({ ticket });
	});

	if (ticket.title && ticket.title !== ticket.key) {
		el.createDiv({ cls: "hptp-ticket-title", text: ticket.title });
	}

	const meta = el.createDiv({ cls: "hptp-ticket-meta" });

	if (ticket.status) {
		meta.createSpan({
			cls: `hptp-chip hptp-chip-status hptp-status-${slug(ticket.status)}`,
			text: ticket.status,
		});
	}
	if (ticket.priority) {
		meta.createSpan({
			cls: `hptp-chip hptp-chip-priority hptp-chip-${ticket.priority}`,
			text: `${PRIORITY_EMOJI[ticket.priority]} ${PRIORITY_LABEL[ticket.priority]}`.trim(),
		});
	}
	if (ticket.date) {
		meta.createSpan({
			cls: "hptp-chip hptp-chip-date",
			text: relativeLabel(ticket.date, ctx.data.today),
		});
	}

	const counts = meta.createSpan({ cls: "hptp-chip hptp-chip-count" });
	counts.setText(
		open.length > 0
			? `${open.length} open${done > 0 ? ` · ${done} done` : ""}`
			: ticket.tasks.length > 0
				? `all ${ticket.tasks.length} done`
				: "no tasks",
	);

	if (open.length === 0) return;

	const key = `group:ticket:${ticket.key}`;
	const expanded = ctx.isExpanded(key);
	const limit = 4;
	const shown = expanded ? open : open.slice(0, limit);

	const list = el.createDiv({ cls: "hptp-task-list hptp-ticket-tasks" });
	for (const task of shown) {
		renderTaskItem(list, task, ctx, {
			draggable: true,
			showSource: false,
		});
	}

	if (open.length > limit) {
		const more = el.createEl("button", {
			cls: "hptp-show-more",
			text: expanded ? "Show fewer" : `Show all ${open.length}`,
		});
		more.addEventListener("click", () => {
			ctx.setExpanded(key, !expanded);
			ctx.redraw();
		});
	}
}

/** CSS-safe slug for a status value. */
function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
