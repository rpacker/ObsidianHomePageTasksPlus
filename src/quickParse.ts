/**
 * Parses shorthand out of a one-line task entry.
 *
 * Supported tokens, anywhere in the line:
 *   !1 … !5        priority, highest to lowest
 *   !high, !low…   priority by name
 *   @today, @tomorrow, @mon…@sun, @2026-11-20, @11/20   due date
 *   #tag           left in the description, Obsidian handles it
 *   T3F-340        recognised as a ticket, left in the description
 *
 * Everything not recognised stays in the description untouched.
 */

import { addDays, fromISO, toISO, todayISO } from "./dates";
import type { Priority } from "./types";

export interface ParsedEntry {
	description: string;
	priority: Priority | null;
	due: string | null;
}

const PRIORITY_BY_NAME: Record<string, Priority> = {
	"1": "highest",
	highest: "highest",
	urgent: "highest",
	"2": "high",
	high: "high",
	"3": "medium",
	medium: "medium",
	med: "medium",
	"4": "low",
	low: "low",
	"5": "lowest",
	lowest: "lowest",
};

const WEEKDAYS: Record<string, number> = {
	sun: 0,
	sunday: 0,
	mon: 1,
	monday: 1,
	tue: 2,
	tues: 2,
	tuesday: 2,
	wed: 3,
	weds: 3,
	wednesday: 3,
	thu: 4,
	thur: 4,
	thurs: 4,
	thursday: 4,
	fri: 5,
	friday: 5,
	sat: 6,
	saturday: 6,
};

/** Parse one line of shorthand. */
export function parseEntry(input: string, today = todayISO()): ParsedEntry {
	let text = input;
	let priority: Priority | null = null;
	let due: string | null = null;

	// Priority: !token
	const priorityMatch = /(^|\s)!([A-Za-z0-9]+)/.exec(text);
	if (priorityMatch) {
		const found = PRIORITY_BY_NAME[priorityMatch[2].toLowerCase()];
		if (found) {
			priority = found;
			text = text.replace(priorityMatch[0], " ");
		}
	}

	// Due date: @token
	const dueMatch = /(^|\s)@([A-Za-z0-9/-]+)/.exec(text);
	if (dueMatch) {
		const parsed = parseDateToken(dueMatch[2], today);
		if (parsed) {
			due = parsed;
			text = text.replace(dueMatch[0], " ");
		}
	}

	return {
		description: text.replace(/\s+/g, " ").trim(),
		priority,
		due,
	};
}

/** Turn a single date token into an ISO date, or null. */
export function parseDateToken(token: string, today = todayISO()): string | null {
	const t = token.toLowerCase();

	if (t === "today") return today;
	if (t === "tomorrow" || t === "tmr" || t === "tom") return addDays(today, 1);
	if (t === "yesterday") return addDays(today, -1);

	// +3 / +3d — days from today.
	const relative = /^\+?(\d+)d?$/.exec(t);
	if (relative && token.startsWith("+")) {
		return addDays(today, Number(relative[1]));
	}

	if (t === "nextweek" || t === "next-week") return addDays(today, 7);

	// Full ISO date.
	const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
	if (iso) {
		const candidate = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(
			2,
			"0",
		)}`;
		return fromISO(candidate) ? candidate : null;
	}

	// M/D or M/D/YYYY, matching the US ordering used elsewhere in the vault.
	const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
	if (slash) {
		const base = fromISO(today);
		if (!base) return null;
		let year = base.getFullYear();
		if (slash[3]) {
			year = Number(slash[3]);
			if (year < 100) year += 2000;
		}
		const month = Number(slash[1]);
		const day = Number(slash[2]);
		if (month < 1 || month > 12 || day < 1 || day > 31) return null;
		const candidate = new Date(year, month - 1, day);
		if (candidate.getMonth() !== month - 1) return null;
		// A bare M/D already past this year means next year.
		if (!slash[3] && toISO(candidate) < today) {
			candidate.setFullYear(year + 1);
		}
		return toISO(candidate);
	}

	// Weekday name — the next occurrence, never today.
	if (t in WEEKDAYS) {
		const base = fromISO(today);
		if (!base) return null;
		const target = WEEKDAYS[t];
		let delta = (target - base.getDay() + 7) % 7;
		if (delta === 0) delta = 7;
		return addDays(today, delta);
	}

	return null;
}
