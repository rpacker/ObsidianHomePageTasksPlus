/**
 * Runs the Claude Code CLI as a child process.
 *
 * Desktop only — the plugin manifest declares `isDesktopOnly`, and every
 * entry point here fails with a clear message rather than throwing if the
 * Node APIs are somehow unavailable.
 *
 * The prompt travels on stdin, not argv, so a long one cannot hit the
 * platform's argument-length limit or leak into the process table.
 */

import { App, FileSystemAdapter } from "obsidian";
import type { HomePageSettings } from "./settings";

/** Extra directories added to PATH when looking for the executable. */
const EXTRA_PATH_DIRS = [
	"/usr/local/bin",
	"/usr/bin",
	"/bin",
	"/opt/homebrew/bin",
	"/snap/bin",
];

interface ChildProcessModule {
	spawn: (
		command: string,
		args: string[],
		options: Record<string, unknown>,
	) => {
		stdout: { on(event: "data", cb: (chunk: unknown) => void): void };
		stderr: { on(event: "data", cb: (chunk: unknown) => void): void };
		stdin: {
			write(data: string): void;
			end(): void;
			on(event: "error", cb: (err: Error) => void): void;
		};
		on(event: "error", cb: (err: Error) => void): void;
		on(event: "close", cb: (code: number | null) => void): void;
		kill(signal?: string): void;
	};
}

export interface RunResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	message: string;
}

export class ClaudeService {
	constructor(
		private app: App,
		private getSettings: () => HomePageSettings,
	) {}

	/** Absolute path of the vault on disk, or null on a non-file adapter. */
	vaultPath(): string | null {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
		return null;
	}

	/** Load `child_process`, or null when it is not reachable. */
	private childProcess(): ChildProcessModule | null {
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const required = (
				window as unknown as {
					require?: (id: string) => ChildProcessModule;
				}
			).require;
			if (typeof required === "function") {
				return required("child_process");
			}
		} catch {
			// Fall through to the error below.
		}
		return null;
	}

	/** PATH with the usual CLI install locations appended. */
	private buildPath(): string {
		const env = (
			globalThis as unknown as {
				process?: { env?: Record<string, string | undefined> };
			}
		).process?.env;

		const current = env?.PATH ?? "";
		const home = env?.HOME ?? "";
		const extras = [...EXTRA_PATH_DIRS];
		if (home) {
			extras.unshift(`${home}/.local/bin`, `${home}/bin`);
		}

		const seen = new Set(current.split(":").filter(Boolean));
		const additions = extras.filter((dir) => !seen.has(dir));
		return [current, ...additions].filter(Boolean).join(":");
	}

	/**
	 * Run the CLI with `prompt` on stdin and return its stdout.
	 * `extraArgs` is used by the connection test.
	 */
	private run(
		args: string[],
		prompt: string | null,
		timeoutMs: number,
	): Promise<RunResult> {
		const cp = this.childProcess();
		if (!cp) {
			return Promise.resolve({
				ok: false,
				stdout: "",
				stderr: "",
				message:
					"Node's child_process is unavailable, so the CLI cannot be launched. This feature needs Obsidian desktop.",
			});
		}

		const cwd = this.vaultPath();
		if (!cwd) {
			return Promise.resolve({
				ok: false,
				stdout: "",
				stderr: "",
				message:
					"The vault is not on a local filesystem, so the CLI has no working directory.",
			});
		}

		const executable = this.getSettings().claudePath.trim() || "claude";

		return new Promise<RunResult>((resolve) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | null = null;

			const finish = (result: RunResult) => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				resolve(result);
			};

			let child: ReturnType<ChildProcessModule["spawn"]>;
			try {
				child = cp.spawn(executable, args, {
					cwd,
					env: {
						...((
							globalThis as unknown as {
								process?: {
									env?: Record<string, string | undefined>;
								};
							}
						).process?.env ?? {}),
						PATH: this.buildPath(),
					},
					shell: false,
				});
			} catch (err) {
				finish({
					ok: false,
					stdout: "",
					stderr: "",
					message: `Could not start '${executable}': ${describe(err)}`,
				});
				return;
			}

			timer = setTimeout(() => {
				try {
					child.kill("SIGTERM");
				} catch {
					// Already gone.
				}
				finish({
					ok: false,
					stdout,
					stderr,
					message: `'${executable}' did not finish within ${Math.round(
						timeoutMs / 1000,
					)}s. Raise the timeout in settings, or try a smaller summary.`,
				});
			}, timeoutMs);

			child.stdout.on("data", (chunk) => {
				stdout += String(chunk);
			});
			child.stderr.on("data", (chunk) => {
				stderr += String(chunk);
			});

			child.on("error", (err) => {
				const hint = /ENOENT/.test(String(err))
					? ` '${executable}' was not found on PATH. Set an absolute path in settings — 'which claude' in a terminal will tell you it.`
					: "";
				finish({
					ok: false,
					stdout,
					stderr,
					message: `Could not run '${executable}': ${describe(err)}.${hint}`,
				});
			});

			child.on("close", (code) => {
				if (code === 0) {
					finish({
						ok: true,
						stdout: stdout.trim(),
						stderr: stderr.trim(),
						message: "ok",
					});
					return;
				}
				const detail = (stderr.trim() || stdout.trim()).slice(0, 600);
				finish({
					ok: false,
					stdout,
					stderr,
					message: `'${executable}' exited with code ${code}.${
						detail ? ` ${detail}` : ""
					}`,
				});
			});

			if (prompt !== null) {
				child.stdin.on("error", () => {
					// The process may have died before we finished writing;
					// the close handler reports the real problem.
				});
				try {
					child.stdin.write(prompt);
					child.stdin.end();
				} catch {
					// Same as above.
				}
			} else {
				try {
					child.stdin.end();
				} catch {
					// Nothing to close.
				}
			}
		});
	}

	/** Ask Claude for a summary. Returns the text, or throws with a reason. */
	async summarise(prompt: string): Promise<string> {
		const s = this.getSettings();
		const args = ["-p", "--output-format", "text"];
		if (s.claudeModel) args.push("--model", s.claudeModel);

		const result = await this.run(
			args,
			prompt,
			Math.max(30, s.claudeTimeoutSeconds) * 1000,
		);

		if (!result.ok) throw new Error(result.message);

		const text = result.stdout.trim();
		if (!text) {
			throw new Error(
				"The CLI ran but returned nothing. Check 'claude -p' works in a terminal inside your vault.",
			);
		}
		return text;
	}

	/** Verify the executable runs, for the settings-tab test button. */
	async testConnection(): Promise<{ ok: boolean; message: string }> {
		const result = await this.run(["--version"], null, 30_000);
		if (result.ok) {
			const version = result.stdout.split("\n")[0]?.trim();
			return {
				ok: true,
				message: `Claude CLI is working — ${version || "version unknown"}.`,
			};
		}
		return { ok: false, message: result.message };
	}
}

/** Readable text for an unknown thrown value. */
function describe(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
