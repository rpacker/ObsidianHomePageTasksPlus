/**
 * Builds the prompt for the AI daily summary.
 *
 * The prompt carries the home page's own numbers as plain text, so the model
 * summarises exactly what you were looking at. It is explicitly told not to
 * read the vault or use tools: everything it needs is in the prompt, and a
 * tool-using run would be slow and could wander.
 */

import { fullLabel, relativeLabel } from "./dates";
import { displayText, PRIORITY_LABEL } from "./taskFormat";
import { effectiveDate, isClosed, type HomeData } from "./homeData";
import type { HomePageSettings } from "./settings";
import type { Task } from "./types";

/** One task rendered as a prompt line. */
function taskLine(task: Task): string {
	const bits: string[] = [`- ${displayText(task.description)}`];
	if (task.priority !== "normal") {
		bits.push(`[priority: ${PRIORITY_LABEL[task.priority]}]`);
	}
	const date = effectiveDate(task);
	if (date) bits.push(`[due: ${date} — ${relativeLabel(date)}]`);
	if (task.ticket) bits.push(`[ticket: ${task.ticket}]`);
	return bits.join(" ");
}

/** A heading plus its tasks, or nothing when the group is empty. */
function section(title: string, tasks: Task[], limit = 40): string {
	if (tasks.length === 0) return "";
	const lines = tasks.slice(0, limit).map(taskLine);
	if (tasks.length > limit) {
		lines.push(`- …and ${tasks.length - limit} more`);
	}
	return `${title}\n${lines.join("\n")}\n`;
}

/** The factual block describing the current state of the home page. */
export function buildContext(data: HomeData): string {
	const { stats, buckets, tickets } = data;

	const parts: string[] = [];

	parts.push(`Date: ${fullLabel(data.today)} (${data.today})`);
	parts.push(
		[
			`Open tasks: ${stats.openTotal}`,
			`due today: ${stats.dueToday}`,
			`overdue: ${stats.overdue}`,
			`completed today: ${stats.completedToday}`,
			`completed this week: ${stats.completedThisWeek}`,
			`current streak: ${stats.streak} day(s)`,
		].join(" · "),
	);
	parts.push("");

	parts.push(section("## Overdue", buckets.overdue));
	parts.push(section("## Due today", buckets.today));
	parts.push(section("## Due tomorrow", buckets.tomorrow));
	parts.push(section("## Upcoming", buckets.upcoming, 20));
	parts.push(section("## No date", buckets.someday, 20));

	const completedToday = data.tasks.filter(
		(t) => t.status === "done" && t.done === data.today,
	);
	parts.push(section("## Completed today", completedToday));

	const active = tickets.filter(
		(t) => t.tasks.some((task) => !isClosed(task)),
	);
	if (active.length > 0) {
		const lines = active.slice(0, 20).map((ticket) => {
			const open = ticket.tasks.filter((t) => !isClosed(t)).length;
			const meta: string[] = [`${open} open task(s)`];
			if (ticket.status) meta.push(`status: ${ticket.status}`);
			if (ticket.priority) {
				meta.push(`priority: ${PRIORITY_LABEL[ticket.priority]}`);
			}
			const title =
				ticket.title && ticket.title !== ticket.key
					? ` — ${ticket.title}`
					: "";
			return `- ${ticket.key}${title} (${meta.join(", ")})`;
		});
		parts.push(`## Active tickets\n${lines.join("\n")}\n`);
	}

	return parts.filter((p) => p.length > 0).join("\n");
}

/** The full prompt sent to the CLI. */
export function buildPrompt(
	data: HomeData,
	settings: HomePageSettings,
): string {
	const context = buildContext(data);

	const instructions = [
		"You are writing the summary section of someone's Obsidian daily note.",
		"",
		"Below is a snapshot of their task home page for today. Write a short, plain summary of where things stand. Requirements:",
		"",
		"- Open with one or two sentences on the shape of the day: what is due, what is late, what got finished.",
		"- Then a short bullet list of what deserves attention today, most important first. Lead with anything overdue, and name the ticket when a task has one.",
		"- Group related tasks instead of restating the list line by line. If a ticket has several open tasks, say so as one bullet.",
		"- Mention the completion count only if it is interesting (a good day, or nothing finished yet).",
		"- Be specific and factual. Use only what is in the snapshot: do not invent tasks, deadlines, people or ticket numbers, and do not pad with encouragement.",
		"- No preamble, no sign-off, no heading — the note already has one. Start with the prose. Markdown bullets are fine.",
		"- Aim for 120 words or fewer.",
		"- Do not use any tools and do not read any files. Everything you need is in this prompt.",
	];

	if (settings.summaryExtraInstructions.trim()) {
		instructions.push("", "Additional instructions from the user:");
		instructions.push(settings.summaryExtraInstructions.trim());
	}

	instructions.push("", "--- Home page snapshot ---", "", context);

	return instructions.join("\n");
}

/**
 * A deterministic summary, used when AI is turned off or the CLI fails.
 * Same content, no model involved.
 */
export function buildFallbackSummary(data: HomeData): string {
	const { stats, buckets } = data;
	const lines: string[] = [];

	const headline: string[] = [];
	headline.push(
		stats.openTotal === 1
			? "1 open task"
			: `${stats.openTotal} open tasks`,
	);
	if (stats.dueToday > 0) headline.push(`${stats.dueToday} due today`);
	if (stats.overdue > 0) headline.push(`${stats.overdue} overdue`);
	if (stats.completedToday > 0) {
		headline.push(`${stats.completedToday} completed today`);
	}
	lines.push(`${headline.join(" · ")}.`);
	lines.push("");

	const focus = [...buckets.overdue, ...buckets.today].slice(0, 8);
	if (focus.length > 0) {
		lines.push("**Needs attention today**");
		for (const task of focus) {
			const date = effectiveDate(task);
			const suffix = date ? ` _(${relativeLabel(date)})_` : "";
			const ticket = task.ticket ? ` · ${task.ticket}` : "";
			lines.push(`- ${displayText(task.description)}${suffix}${ticket}`);
		}
		lines.push("");
	}

	const activeTickets = data.tickets
		.filter((t) => t.tasks.some((task) => !isClosed(task)))
		.slice(0, 6);
	if (activeTickets.length > 0) {
		lines.push("**Active tickets**");
		for (const ticket of activeTickets) {
			const open = ticket.tasks.filter((t) => !isClosed(t)).length;
			lines.push(
				`- [[${ticket.key}]] — ${open} open task${open === 1 ? "" : "s"}`,
			);
		}
		lines.push("");
	}

	if (focus.length === 0 && activeTickets.length === 0) {
		lines.push("Nothing due and no active tickets.");
	}

	return lines.join("\n").trim();
}
