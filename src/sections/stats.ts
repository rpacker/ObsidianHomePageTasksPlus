/** "Stats": headline numbers plus a seven-day completion bar. */

import { renderCard } from "../ui/card";
import { fromISO } from "../dates";
import type { SectionContext } from "./context";

export function renderStats(parent: HTMLElement, ctx: SectionContext): void {
	const { stats } = ctx.data;

	const card = renderCard(parent, ctx, {
		title: "Stats",
		icon: "bar-chart-3",
		key: "section:stats",
		badge: `${stats.completedThisWeek} this week`,
	});

	if (card.collapsed) return;

	const grid = card.body.createDiv({ cls: "hptp-stat-grid" });

	stat(grid, "Open", stats.openTotal, "neutral");
	stat(grid, "Due today", stats.dueToday, stats.dueToday > 0 ? "warn" : "neutral");
	stat(grid, "Overdue", stats.overdue, stats.overdue > 0 ? "bad" : "good");
	stat(
		grid,
		"Done today",
		stats.completedToday,
		stats.completedToday > 0 ? "good" : "neutral",
	);
	stat(grid, "Done this week", stats.completedThisWeek, "neutral");
	stat(
		grid,
		"Streak",
		stats.streak,
		stats.streak > 0 ? "good" : "neutral",
		stats.streak === 1 ? "day" : "days",
	);

	// Seven-day bar row.
	const chartWrap = card.body.createDiv({ cls: "hptp-chart" });
	chartWrap.createDiv({
		cls: "hptp-chart-title",
		text: "Tasks completed, last 7 days",
	});

	const max = Math.max(1, ...stats.week.map((d) => d.completed));
	const bars = chartWrap.createDiv({ cls: "hptp-bars" });

	for (const day of stats.week) {
		const column = bars.createDiv({ cls: "hptp-bar-column" });
		if (day.date === ctx.data.today) column.addClass("hptp-bar-today");

		const track = column.createDiv({ cls: "hptp-bar-track" });
		const fill = track.createDiv({ cls: "hptp-bar-fill" });
		// A completed day always shows a visible sliver.
		const pct = day.completed === 0 ? 0 : Math.max(8, (day.completed / max) * 100);
		fill.style.height = `${pct}%`;
		if (day.completed === 0) fill.addClass("hptp-bar-zero");

		column.createDiv({
			cls: "hptp-bar-value",
			text: String(day.completed),
		});

		const parsed = fromISO(day.date);
		column.createDiv({
			cls: "hptp-bar-label",
			text: parsed
				? parsed.toLocaleDateString(undefined, { weekday: "narrow" })
				: "",
		});

		column.setAttribute(
			"title",
			`${day.date}: ${day.completed} completed`,
		);
	}

	if (stats.completedThisWeek === 0) {
		card.body.createDiv({
			cls: "hptp-empty",
			text: "No completions recorded yet. Completion dates come from the ✅ stamp, which is added when you tick a task here.",
		});
	}
}

type Tone = "neutral" | "good" | "warn" | "bad";

function stat(
	parent: HTMLElement,
	label: string,
	value: number,
	tone: Tone,
	suffix?: string,
): void {
	const box = parent.createDiv({ cls: `hptp-stat hptp-stat-${tone}` });
	const valueEl = box.createDiv({ cls: "hptp-stat-value" });
	valueEl.createSpan({ text: String(value) });
	if (suffix) valueEl.createSpan({ cls: "hptp-stat-suffix", text: suffix });
	box.createDiv({ cls: "hptp-stat-label", text: label });
}
