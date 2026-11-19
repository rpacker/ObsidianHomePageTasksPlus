/**
 * Aggregates everything the home page shows into one snapshot.
 *
 * The view renders from this, and the AI summary is built from the very same
 * object — which is what makes the daily note a summary of the home page
 * rather than a second, independently-computed view of the vault.
 */

import {
	bucketFor,
	daysBetween,
	startOfWeek,
	todayISO,
} from "./dates";
import { groupTasks, type TaskGroup } from "./groups";
import type {
	DateBucket,
	Priority,
	Task,
	TaskSort,
	Ticket,
	DailyNote,
} from "./types";
import { PRIORITY_ORDER } from "./types";
import type { HomePageSettings } from "./settings";

export interface Stats {
	openTotal: number;
	overdue: number;
	dueToday: number;
	completedToday: number;
	completedThisWeek: number;
	/** Completion counts for the last seven days, oldest first. */
	week: { date: string; completed: number }[];
	/** Consecutive days up to today with at least one completion. */
	streak: number;
}

export interface HomeData {
	today: string;
	tasks: Task[];
	/** Open tasks grouped by date bucket. */
	buckets: Record<DateBucket, Task[]>;
	/** Open tasks grouped by priority. */
	byPriority: Record<Priority, Task[]>;
	/**
	 * The blocks the task sections are split into: one per configured group,
	 * plus "Other" for unassigned folders. A single block when `grouped` is
	 * false.
	 */
	groups: TaskGroup[];
	/** True when the user has defined groups, so blocks get a header. */
	grouped: boolean;
	tickets: Ticket[];
	dailyNotes: DailyNote[];
	stats: Stats;
}

/** The date a task is judged by: due first, then scheduled, then start. */
export function effectiveDate(task: Task): string | null {
	return task.due ?? task.scheduled ?? task.start ?? null;
}

/** True when a task counts as finished. */
export function isClosed(task: Task): boolean {
	return task.status === "done" || task.status === "cancelled";
}

/**
 * Sort open tasks for display: overdue first by how late they are, then by
 * priority, then by date, then alphabetically so the order is stable.
 */
export function compareTasks(a: Task, b: Task): number {
	// Completed tasks sink, so showing them never buries live work.
	const ca = isClosed(a) ? 1 : 0;
	const cb = isClosed(b) ? 1 : 0;
	if (ca !== cb) return ca - cb;

	const pa = PRIORITY_ORDER.indexOf(a.priority);
	const pb = PRIORITY_ORDER.indexOf(b.priority);
	if (pa !== pb) return pa - pb;

	const da = effectiveDate(a);
	const db = effectiveDate(b);
	if (da && db && da !== db) return da.localeCompare(db);
	if (da && !db) return -1;
	if (!da && db) return 1;

	return a.description.localeCompare(b.description);
}

/** Sort by date first, used inside the date buckets. */
export function compareByDate(a: Task, b: Task): number {
	const ca = isClosed(a) ? 1 : 0;
	const cb = isClosed(b) ? 1 : 0;
	if (ca !== cb) return ca - cb;

	const da = effectiveDate(a);
	const db = effectiveDate(b);
	if (da && db && da !== db) return da.localeCompare(db);
	if (da && !db) return -1;
	if (!da && db) return 1;
	return compareTasks(a, b);
}

type Comparator = (a: Task, b: Task) => number;

/** Completed tasks sink, so showing them never buries live work. */
const closedLast: Comparator = (a, b) =>
	(isClosed(a) ? 1 : 0) - (isClosed(b) ? 1 : 0);

/** Earliest date first; undated tasks last. */
const dateAscending: Comparator = (a, b) => {
	const da = effectiveDate(a);
	const db = effectiveDate(b);
	if (da && db && da !== db) return da.localeCompare(db);
	if (da && !db) return -1;
	if (!da && db) return 1;
	return 0;
};

/** Latest date first; undated tasks still last, since they are not "late". */
const dateDescending: Comparator = (a, b) => {
	const da = effectiveDate(a);
	const db = effectiveDate(b);
	if (da && db && da !== db) return db.localeCompare(da);
	if (da && !db) return -1;
	if (!da && db) return 1;
	return 0;
};

const priorityHighFirst: Comparator = (a, b) =>
	PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);

const nameAscending: Comparator = (a, b) =>
	a.description.localeCompare(b.description);

const reversed =
	(compare: Comparator): Comparator =>
	(a, b) =>
		compare(b, a);

/** Apply comparators in turn until one separates the pair. */
function chain(...comparators: Comparator[]): Comparator {
	return (a, b) => {
		for (const compare of comparators) {
			const result = compare(a, b);
			if (result !== 0) return result;
		}
		return 0;
	};
}

/**
 * The comparator for a sort order chosen on the home page.
 *
 * Whatever the order, closed tasks sink below live work, and ties fall back
 * to the remaining keys so the order is stable from one redraw to the next.
 */
export function taskComparator(sort: TaskSort): Comparator {
	switch (sort) {
		case "date-desc":
			return chain(
				closedLast,
				dateDescending,
				priorityHighFirst,
				nameAscending,
			);
		case "priority-high":
			return compareTasks;
		case "priority-low":
			return chain(
				closedLast,
				reversed(priorityHighFirst),
				dateAscending,
				nameAscending,
			);
		case "name-asc":
			return chain(
				closedLast,
				nameAscending,
				dateAscending,
				priorityHighFirst,
			);
		case "name-desc":
			return chain(
				closedLast,
				reversed(nameAscending),
				dateAscending,
				priorityHighFirst,
			);
		case "date-asc":
		default:
			return compareByDate;
	}
}

const EMPTY_BUCKETS = (): Record<DateBucket, Task[]> => ({
	overdue: [],
	today: [],
	tomorrow: [],
	upcoming: [],
	someday: [],
});

const EMPTY_PRIORITIES = (): Record<Priority, Task[]> => ({
	highest: [],
	high: [],
	medium: [],
	normal: [],
	low: [],
	lowest: [],
});

/** Sort tasks into the date buckets, each ordered by `sort`. */
export function bucketByDate(
	tasks: Task[],
	options: {
		showCompleted: boolean;
		upcomingDays: number;
		today: string;
		sort?: TaskSort;
	},
): Record<DateBucket, Task[]> {
	const buckets = EMPTY_BUCKETS();

	for (const task of tasks) {
		if (!options.showCompleted && isClosed(task)) continue;
		const bucket = bucketFor(
			effectiveDate(task),
			options.upcomingDays,
			options.today,
		);
		buckets[bucket].push(task);
	}

	const compare = taskComparator(options.sort ?? "date-asc");
	for (const key of Object.keys(buckets) as DateBucket[]) {
		buckets[key].sort(compare);
	}
	return buckets;
}

/** Sort tasks into the priority lanes, each ordered by date. */
export function bucketByPriority(
	tasks: Task[],
	options: { showCompleted: boolean },
): Record<Priority, Task[]> {
	const byPriority = EMPTY_PRIORITIES();

	for (const task of tasks) {
		if (!options.showCompleted && isClosed(task)) continue;
		byPriority[task.priority].push(task);
	}

	for (const key of Object.keys(byPriority) as Priority[]) {
		byPriority[key].sort(compareByDate);
	}
	return byPriority;
}

/** Build the snapshot. */
export function buildHomeData(
	tasks: Task[],
	tickets: Ticket[],
	dailyNotes: DailyNote[],
	settings: HomePageSettings,
	today = todayISO(),
): HomeData {
	const showCompleted = !settings.hideCompleted;

	const buckets = bucketByDate(tasks, {
		showCompleted,
		upcomingDays: settings.upcomingDays,
		today,
	});
	const byPriority = bucketByPriority(tasks, { showCompleted });

	return {
		today,
		tasks,
		buckets,
		byPriority,
		groups: groupTasks(tasks, settings.taskGroups),
		grouped: settings.taskGroups.length > 0,
		tickets: sortTickets(tickets),
		dailyNotes,
		stats: buildStats(tasks, settings, today),
	};
}

/** Tickets with open work first, then by priority, then most recent. */
export function sortTickets(tickets: Ticket[]): Ticket[] {
	return [...tickets].sort((a, b) => {
		const oa = a.tasks.filter((t) => !isClosed(t)).length;
		const ob = b.tasks.filter((t) => !isClosed(t)).length;
		if (oa !== ob) return ob - oa;

		const pa = a.priority ? PRIORITY_ORDER.indexOf(a.priority) : 99;
		const pb = b.priority ? PRIORITY_ORDER.indexOf(b.priority) : 99;
		if (pa !== pb) return pa - pb;

		return b.mtime - a.mtime;
	});
}

/** Counts and the seven-day activity row. */
export function buildStats(
	tasks: Task[],
	settings: HomePageSettings,
	today = todayISO(),
): Stats {
	const open = tasks.filter((t) => !isClosed(t));
	const weekStart = startOfWeek(today);

	let overdue = 0;
	let dueToday = 0;
	for (const task of open) {
		const date = effectiveDate(task);
		if (!date) continue;
		const diff = daysBetween(today, date);
		if (diff < 0) overdue++;
		else if (diff === 0) dueToday++;
	}

	const completedByDay = new Map<string, number>();
	let completedThisWeek = 0;
	for (const task of tasks) {
		if (task.status !== "done" || !task.done) continue;
		completedByDay.set(
			task.done,
			(completedByDay.get(task.done) ?? 0) + 1,
		);
		if (task.done >= weekStart && task.done <= today) completedThisWeek++;
	}

	const week: { date: string; completed: number }[] = [];
	for (let i = 6; i >= 0; i--) {
		const date = shiftDays(today, -i);
		week.push({ date, completed: completedByDay.get(date) ?? 0 });
	}

	let streak = 0;
	for (let i = 0; i < 366; i++) {
		const date = shiftDays(today, -i);
		if ((completedByDay.get(date) ?? 0) > 0) streak++;
		else break;
	}

	return {
		openTotal: open.length,
		overdue,
		dueToday,
		completedToday: completedByDay.get(today) ?? 0,
		completedThisWeek,
		week,
		streak,
	};
}

/** Local-time day arithmetic on an ISO string. */
function shiftDays(iso: string, delta: number): string {
	const [y, m, d] = iso.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	date.setDate(date.getDate() + delta);
	const yy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${yy}-${mm}-${dd}`;
}
