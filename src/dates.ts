/** Date helpers. All ISO strings are `YYYY-MM-DD` in local time. */

import type { DateBucket } from "./types";

/** Today's date as an ISO day string, in the user's local timezone. */
export function todayISO(): string {
	return toISO(new Date());
}

/** Format a Date as a local `YYYY-MM-DD` (never UTC-shifted). */
export function toISO(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Parse an ISO day string into a local Date at midnight. */
export function fromISO(iso: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return null;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isNaN(d.getTime()) ? null : d;
}

/** Add `days` to an ISO day string. */
export function addDays(iso: string, days: number): string {
	const d = fromISO(iso);
	if (!d) return iso;
	d.setDate(d.getDate() + days);
	return toISO(d);
}

/** Whole days from `a` to `b`; negative when `b` is in the past. */
export function daysBetween(a: string, b: string): number {
	const da = fromISO(a);
	const db = fromISO(b);
	if (!da || !db) return 0;
	return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/**
 * A short human label for a due date: "Today", "Tomorrow", "3d ago",
 * "Fri" within the next week, otherwise a month/day date.
 */
export function relativeLabel(iso: string, today = todayISO()): string {
	const diff = daysBetween(today, iso);
	if (diff === 0) return "Today";
	if (diff === 1) return "Tomorrow";
	if (diff === -1) return "Yesterday";
	if (diff < 0) return `${Math.abs(diff)}d ago`;
	if (diff <= 6) {
		const d = fromISO(iso);
		return d
			? d.toLocaleDateString(undefined, { weekday: "short" })
			: iso;
	}
	const d = fromISO(iso);
	return d
		? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
		: iso;
}

/** A long, unambiguous label used in tooltips. */
export function fullLabel(iso: string): string {
	const d = fromISO(iso);
	if (!d) return iso;
	return d.toLocaleDateString(undefined, {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

/**
 * Which date bucket a task's effective date falls into.
 * `upcomingDays` bounds the "upcoming" window; anything beyond it, or with no
 * date at all, lands in "someday".
 */
export function bucketFor(
	date: string | null,
	upcomingDays: number,
	today = todayISO(),
): DateBucket {
	if (!date) return "someday";
	const diff = daysBetween(today, date);
	if (diff < 0) return "overdue";
	if (diff === 0) return "today";
	if (diff === 1) return "tomorrow";
	if (diff <= upcomingDays) return "upcoming";
	return "someday";
}

/** ISO date of the Monday starting the week containing `iso`. */
export function startOfWeek(iso: string): string {
	const d = fromISO(iso);
	if (!d) return iso;
	const dow = (d.getDay() + 6) % 7; // Monday = 0
	d.setDate(d.getDate() - dow);
	return toISO(d);
}

/** The greeting shown in the hero bar, based on the hour. */
export function greeting(now = new Date()): string {
	const h = now.getHours();
	if (h < 5) return "Still up";
	if (h < 12) return "Good morning";
	if (h < 17) return "Good afternoon";
	if (h < 22) return "Good evening";
	return "Good night";
}
