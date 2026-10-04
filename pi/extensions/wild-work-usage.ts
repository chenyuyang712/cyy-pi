import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Usage = {
	token?: { total?: number; requests?: number };
	credit?: { balance?: number; accounts?: number };
	disabled?: boolean;
};

let creditsLeft = 0;
let creditAccounts = 0;
let updatedAt = "--:--";
let requestFooterRender: (() => void) | undefined;

function compact(value: number | undefined): string {
	const n = Number(value || 0);
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
	return n.toLocaleString("en-US");
}

async function loadEndpoint(): Promise<{ url: string; key: string }> {
	const raw = await readFile(join(homedir(), ".pi", "agent", "models.json"), "utf8");
	const config = JSON.parse(raw) as {
		providers?: Record<string, { baseUrl?: string; apiKey?: string }>;
	};
	const provider = config.providers?.wildwork;
	if (!provider?.baseUrl || !provider.apiKey) throw new Error("wildwork provider 未配置");
	const root = provider.baseUrl.replace(/\/v1\/?$/, "");
	return { url: `${root}/api/usage`, key: provider.apiKey };
}

async function fetchUsage(days: number): Promise<Usage> {
	const endpoint = await loadEndpoint();
	const response = await fetch(`${endpoint.url}?days=${days}`, {
		headers: { Authorization: `Bearer ${endpoint.key}`, Accept: "application/json" },
	});
	if (!response.ok) throw new Error(`wild-work 用量接口 HTTP ${response.status}`);
	return (await response.json()) as Usage;
}

function taskTotals(ctx: any): { input: number; output: number } {
	let input = 0;
	let output = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const message = entry.message as AssistantMessage;
			input += message.usage.input;
			output += message.usage.output;
		}
	}
	return { input, output };
}

function summary(data: Usage, days: number, totals: { input: number; output: number }): string {
	if (data.disabled) return "Usage tracking is disabled";
	return [
		`Current task: ${compact(totals.input + totals.output)} tokens (${compact(totals.input)} in / ${compact(totals.output)} out)`,
		`Server usage (${days}d): ${compact(data.token?.total)} tokens · ${compact(data.token?.requests)} requests`,
		`Credits left: ${Number(data.credit?.balance || 0).toLocaleString("en-US")} (${data.credit?.accounts || 0} accounts)`,
		`Updated: ${updatedAt}`,
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;

	const refresh = async (ctx: any, days: number, notify: boolean) => {
		try {
			const data = await fetchUsage(days);
			creditsLeft = Number(data.credit?.balance || 0);
			creditAccounts = Number(data.credit?.accounts || 0);
			updatedAt = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
			requestFooterRender?.();
			if (notify) ctx.ui.notify(summary(data, days, taskTotals(ctx)), "info");
		} catch (error) {
			requestFooterRender?.();
			if (notify) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
		}
	};

	pi.registerCommand("usage", {
		description: "Show task tokens, server usage, and remaining credits",
		handler: async (args, ctx) => {
			const parsed = Number.parseInt(args.trim(), 10);
			const days = parsed === 1 || parsed === 30 ? parsed : 7;
			await refresh(ctx, days, true);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode === "tui") {
			ctx.ui.setFooter((tui, theme, footerData) => {
				const unsub = footerData.onBranchChange(() => tui.requestRender());
				requestFooterRender = () => tui.requestRender();
				return {
					dispose() {
						unsub();
						requestFooterRender = undefined;
					},
					invalidate() {},
					render(width: number): string[] {
						const totals = taskTotals(ctx);
						const left = theme.fg("dim", `Task spent: ${compact(totals.input + totals.output)} tokens · Credits left: ${Number(creditsLeft).toLocaleString("en-US")} (${creditAccounts} accounts) · Updated: ${updatedAt}`);
						const model = ctx.model?.id || "no-model";
						const right = theme.fg("dim", model);
						const gap = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
						const line = truncateToWidth(left + gap + right, width);
						return [theme.fg("dim", ctx.cwd.replace(homedir(), "~")), line];
					},
				};
			});
		}
		await refresh(ctx, 7, false);
		timer = setInterval(() => void refresh(ctx, 7, false), 5 * 60 * 1000);
	});

	pi.on("session_shutdown", async () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	});
}

