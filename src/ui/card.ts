/** The collapsible card every section is drawn inside. */

import { setIcon } from "obsidian";
import type { SectionContext } from "../sections/context";

export interface CardOptions {
	title: string;
	icon: string;
	/** Stable key used to remember the collapsed state. */
	key: string;
	/** Small count or label shown next to the title. */
	badge?: string;
	/** Buttons rendered in the card header. */
	actions?: {
		icon: string;
		label: string;
		onClick: (ev: MouseEvent) => void;
	}[];
	/** Start collapsed the first time the card is seen. */
	defaultCollapsed?: boolean;
}

export interface Card {
	root: HTMLElement;
	body: HTMLElement;
	collapsed: boolean;
}

/** Draw a card shell and return its body for the caller to fill. */
export function renderCard(
	parent: HTMLElement,
	ctx: SectionContext,
	options: CardOptions,
): Card {
	const root = parent.createDiv({ cls: "hptp-card" });
	const header = root.createDiv({ cls: "hptp-card-header" });

	const collapsed = ctx.isCollapsed(options.key);
	if (collapsed) root.addClass("hptp-collapsed");

	const titleWrap = header.createDiv({ cls: "hptp-card-title" });

	const chevron = titleWrap.createSpan({ cls: "hptp-card-chevron" });
	setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");

	const iconEl = titleWrap.createSpan({ cls: "hptp-card-icon" });
	setIcon(iconEl, options.icon);

	titleWrap.createSpan({ cls: "hptp-card-name", text: options.title });

	if (options.badge) {
		titleWrap.createSpan({
			cls: "hptp-card-badge",
			text: options.badge,
		});
	}

	titleWrap.setAttribute("role", "button");
	titleWrap.setAttribute("tabindex", "0");
	titleWrap.setAttribute(
		"aria-label",
		`${collapsed ? "Expand" : "Collapse"} ${options.title}`,
	);

	const toggle = () => {
		const next = !ctx.isCollapsed(options.key);
		ctx.setCollapsed(options.key, next);
		root.toggleClass("hptp-collapsed", next);
		setIcon(chevron, next ? "chevron-right" : "chevron-down");
	};

	titleWrap.addEventListener("click", toggle);
	titleWrap.addEventListener("keydown", (ev) => {
		if (ev.key === "Enter" || ev.key === " ") {
			ev.preventDefault();
			toggle();
		}
	});

	if (options.actions?.length) {
		const actions = header.createDiv({ cls: "hptp-card-actions" });
		for (const action of options.actions) {
			const button = actions.createEl("button", {
				cls: "hptp-icon-button",
				attr: { "aria-label": action.label, title: action.label },
			});
			setIcon(button, action.icon);
			button.addEventListener("click", (ev) => {
				ev.stopPropagation();
				action.onClick(ev);
			});
		}
	}

	const body = root.createDiv({ cls: "hptp-card-body" });
	return { root, body, collapsed };
}

/** The "nothing here" line used inside cards. */
export function renderEmpty(parent: HTMLElement, text: string): void {
	parent.createDiv({ cls: "hptp-empty", text });
}
