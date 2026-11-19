/** The capabilities each section is handed by the view. */

import type { App } from "obsidian";
import type HomePagePlugin from "../main";
import type { HomeData } from "../homeData";
import type { HomePageSettings } from "../settings";
import type { Priority, Task, Ticket } from "../types";

export interface SectionContext {
	app: App;
	plugin: HomePagePlugin;
	data: HomeData;
	settings: HomePageSettings;

	/** Rescan the vault and redraw the page. */
	refresh(): void;
	/** Redraw from the data already in hand. */
	redraw(): void;
	/**
	 * Change settings from the page itself, save them, and redraw every open
	 * home page. For display options that need no rescan.
	 */
	updateSettings(patch: Partial<HomePageSettings>): void;

	/** Open a file, optionally scrolling to a line. */
	openPath(path: string, line?: number, newLeaf?: boolean): Promise<void>;

	toggleTask(task: Task): Promise<void>;
	setPriority(task: Task, priority: Priority): Promise<void>;
	setDue(task: Task, due: string | null): Promise<void>;
	setStatus(task: Task, status: Task["status"]): Promise<void>;
	removeTask(task: Task): Promise<void>;
	editTask(task: Task): Promise<void>;

	/** Open the add-task dialog, optionally aimed at a ticket. */
	addTask(options?: { ticket?: Ticket; due?: string | null }): Promise<void>;

	/** Whether a collapsible block is currently open. */
	isCollapsed(key: string): boolean;
	setCollapsed(key: string, collapsed: boolean): void;

	/** Whether a group is showing all of its items. */
	isExpanded(key: string): boolean;
	setExpanded(key: string, expanded: boolean): void;
}
