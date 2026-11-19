/**
 * Task groups: splitting tasks by the top-level folder their file lives in.
 *
 * A group is a named set of top-level folders. Everything here is pure, so
 * the same rules drive the home page, the settings tab and the tests.
 */

import type { Task, TaskGroupConfig } from "./types";

/** The most groups a user can define. */
export const MAX_TASK_GROUPS = 3;

/** Stands in for "notes in the vault root", which have no top-level folder. */
export const ROOT_FOLDER = "/";

/** Id of the catch-all block holding tasks from unassigned folders. */
export const OTHER_GROUP_ID = "other";

/** Id of the single block used when no groups are defined. */
export const ALL_GROUP_ID = "all";

/** The ids handed out to user groups, in order. */
const GROUP_IDS = ["g1", "g2", "g3"];

/** A group as the home page shows it: its config plus the tasks it holds. */
export interface TaskGroup {
	id: string;
	name: string;
	/** Top-level folders feeding the group; empty for the catch-all blocks. */
	folders: string[];
	/** Every task in the group, open and closed. */
	tasks: Task[];
}

/** The top-level folder a vault path sits in, or `ROOT_FOLDER`. */
export function topLevelFolder(path: string): string {
	const clean = path.replace(/^\/+/, "");
	const slash = clean.indexOf("/");
	return slash === -1 ? ROOT_FOLDER : clean.slice(0, slash);
}

/** Reduce a stored folder entry to the top-level folder it names. */
function normaliseFolder(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (trimmed === ROOT_FOLDER) return ROOT_FOLDER;
	const first = trimmed.replace(/^\/+/, "").split("/")[0].trim();
	return first.length > 0 ? first : null;
}

/**
 * The name shown for the group at `index`, falling back to "Group N" while
 * it has no name of its own.
 */
export function groupDisplayName(
	group: { name: string },
	index: number,
): string {
	return group.name.trim() || `Group ${index + 1}`;
}

/** The name shown for a folder entry. */
export function folderDisplayName(folder: string): string {
	return folder === ROOT_FOLDER ? "Vault root" : folder;
}

/**
 * Clean up stored group config: at most `MAX_TASK_GROUPS` groups, known and
 * unique ids, and each folder in one group only (the first one listing it).
 */
export function sanitiseTaskGroups(raw: unknown): TaskGroupConfig[] {
	if (!Array.isArray(raw)) return [];

	const out: TaskGroupConfig[] = [];
	const usedIds = new Set<string>();
	const usedFolders = new Set<string>();

	for (const entry of raw) {
		if (out.length >= MAX_TASK_GROUPS) break;
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as Partial<TaskGroupConfig>;

		let id =
			typeof candidate.id === "string" &&
			GROUP_IDS.includes(candidate.id) &&
			!usedIds.has(candidate.id)
				? candidate.id
				: null;
		id ??= GROUP_IDS.find((free) => !usedIds.has(free)) ?? null;
		if (!id) break;
		usedIds.add(id);

		const folders: string[] = [];
		for (const item of Array.isArray(candidate.folders)
			? candidate.folders
			: []) {
			const folder = normaliseFolder(item);
			if (!folder || usedFolders.has(folder)) continue;
			usedFolders.add(folder);
			folders.push(folder);
		}

		out.push({
			id,
			name: typeof candidate.name === "string" ? candidate.name.trim() : "",
			folders,
		});
	}

	return out;
}

/** A fresh, empty group, or null when the limit has been reached. */
export function createTaskGroup(
	groups: TaskGroupConfig[],
): TaskGroupConfig | null {
	if (groups.length >= MAX_TASK_GROUPS) return null;
	const id = GROUP_IDS.find((free) => !groups.some((g) => g.id === free));
	return id ? { id, name: "", folders: [] } : null;
}

/** The id of the group a folder is assigned to, or null. */
export function groupIdForFolder(
	groups: TaskGroupConfig[],
	folder: string,
): string | null {
	return groups.find((g) => g.folders.includes(folder))?.id ?? null;
}

/**
 * The id of the block a file's tasks are shown in: its group, the "other"
 * catch-all, or the single "all" block when no groups are defined.
 */
export function groupIdForPath(
	groups: TaskGroupConfig[],
	path: string,
): string {
	if (groups.length === 0) return ALL_GROUP_ID;
	return groupIdForFolder(groups, topLevelFolder(path)) ?? OTHER_GROUP_ID;
}

/**
 * Put `folder` in the group `groupId`, taking it out of any other group.
 * A null `groupId` leaves it unassigned.
 */
export function assignFolder(
	groups: TaskGroupConfig[],
	folder: string,
	groupId: string | null,
): void {
	for (const group of groups) {
		group.folders = group.folders.filter((f) => f !== folder);
	}
	const target = groups.find((g) => g.id === groupId);
	if (target) target.folders.push(folder);
}

/** Follow a top-level folder rename. Returns true when anything changed. */
export function renameGroupFolder(
	groups: TaskGroupConfig[],
	oldName: string,
	newName: string,
): boolean {
	if (oldName === newName) return false;
	const owner = groups.find((g) => g.folders.includes(oldName));
	if (!owner) return false;

	const taken = groups.some((g) => g.folders.includes(newName));
	owner.folders = taken
		? owner.folders.filter((f) => f !== oldName)
		: owner.folders.map((f) => (f === oldName ? newName : f));
	return true;
}

/**
 * Split tasks into the blocks the task sections show.
 *
 * With no groups defined there is one unnamed block holding everything, so
 * the page looks the way it did before groups existed. Otherwise there is one
 * block per group, in the configured order, followed by "Other" when tasks
 * exist in folders no group claims — nothing is ever silently dropped.
 */
export function groupTasks(
	tasks: Task[],
	groups: TaskGroupConfig[],
): TaskGroup[] {
	if (groups.length === 0) {
		return [{ id: ALL_GROUP_ID, name: "", folders: [], tasks }];
	}

	const blocks = new Map<string, TaskGroup>();
	const byFolder = new Map<string, TaskGroup>();

	groups.forEach((group, index) => {
		const block: TaskGroup = {
			id: group.id,
			name: groupDisplayName(group, index),
			folders: [...group.folders],
			tasks: [],
		};
		blocks.set(group.id, block);
		for (const folder of group.folders) {
			if (!byFolder.has(folder)) byFolder.set(folder, block);
		}
	});

	const other: TaskGroup = {
		id: OTHER_GROUP_ID,
		name: "Other",
		folders: [],
		tasks: [],
	};
	const otherFolders = new Set<string>();

	for (const task of tasks) {
		const folder = topLevelFolder(task.path);
		const block = byFolder.get(folder);
		if (block) {
			block.tasks.push(task);
		} else {
			other.tasks.push(task);
			otherFolders.add(folder);
		}
	}

	other.folders = [...otherFolders].sort((a, b) => a.localeCompare(b));

	const out = [...blocks.values()];
	if (other.tasks.length > 0) out.push(other);
	return out;
}
