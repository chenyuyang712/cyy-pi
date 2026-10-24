/**
 * statusline.ts — 精简状态栏
 *
 * 左栏：上下文进度条 · 百分比 · 用量 · git 分支 · 生成速度
 * 右栏：模型 · 思考强度 · 供应商 · 订阅额度
 *
 * 数据来源：
 * - 模型/供应商/思考强度：ctx.model、ctx.thinkingLevel
 * - 上下文占用：ctx.getContextUsage()
 * - 生成速度：首字节 → 消息结束之间的输出 token 速率（流式期间按字符数估算，结束时用真实 usage）
 * - 订阅额度：provider 响应头里的限流信息（Anthropic unified 5h 窗口 / 通用 x-ratelimit-*），
 *   没有则自动隐藏；超过 10 分钟未更新视为过期
 *
 * 命令：/statusline  开关自定义状态栏
 */

import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const THINKING_ROLE: Record<string, string> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

/** 额度信息多久没更新就丢弃（毫秒） */
const QUOTA_TTL_MS = 10 * 60 * 1000;
/** 估算 token 时每 token 的字符数（流式期间没有真实 usage 时使用） */
const CHARS_PER_TOKEN = 4;
/** 分支名超过这个长度就保留尾部 */
const BRANCH_MAX = 18;
/** 进度条格数 */
const BAR_CELLS = 10;

type Quota =
	| { kind: "window"; label: string; percent: number }
	| { kind: "requests"; label: string; remaining: number; limit: number };

let lastTps: number | null = null;
let streamingTps: number | null = null;
let quota: Quota | null = null;
let quotaAt = 0;
let requestStartAt: number | null = null;
let firstChunkAt: number | null = null;
let liveChars = 0;
let liveOutput = 0;
let tuiRef: { requestRender(): void } | null = null;
let renderEnabled = true;

function resetSessionState(): void {
	lastTps = null;
	streamingTps = null;
	quota = null;
	quotaAt = 0;
	requestStartAt = null;
	firstChunkAt = null;
	liveChars = 0;
	liveOutput = 0;
}

function fmtTokens(n: number): string {
	if (n < 1000) return `${Math.round(n)}`;
	if (n < 1_000_000) {
		const k = n / 1000;
		return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
	}
	const m = n / 1_000_000;
	return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`;
}

/** 小于 1% 时保留一位小数，避免新会话一直显示 0% */
function fmtPercent(percent: number): string {
	if (percent > 0 && percent < 1) return `${percent.toFixed(1)}%`;
	return `${percent.toFixed(0)}%`;
}

/** 分支名过长时保留尾部（尾部信息量更大） */
function shortenBranch(branch: string): string {
	if (branch.length <= BRANCH_MAX) return branch;
	const slash = branch.lastIndexOf("/");
	if (slash >= 0) {
		const prefix = "…/";
		const tail = branch.slice(slash + 1);
		if (tail.length + prefix.length <= BRANCH_MAX) return prefix + tail;
		return prefix + tail.slice(-(BRANCH_MAX - prefix.length));
	}
	return `…${branch.slice(-(BRANCH_MAX - 1))}`;
}

function header(headers: Record<string, string>, name: string): string | undefined {
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase() === lower) return value;
	}
	return undefined;
}

function readQuota(headers: Record<string, string>): Quota | null {
	const utilization = header(headers, "anthropic-ratelimit-unified-5h-utilization");
	if (utilization !== undefined) {
		const value = Number(utilization);
		if (Number.isFinite(value)) {
			return { kind: "window", label: "5h", percent: Math.max(0, Math.min(100, value * 100)) };
		}
	}
	const remaining = header(headers, "x-ratelimit-remaining-requests");
	const limit = header(headers, "x-ratelimit-limit-requests");
	if (remaining !== undefined && limit !== undefined) {
		const rem = Number(remaining);
		const lim = Number(limit);
		if (Number.isFinite(rem) && Number.isFinite(lim) && lim > 0) {
			return { kind: "requests", label: "quota", remaining: rem, limit: lim };
		}
	}
	return null;
}

/** 读取当前有效额度（过期即丢弃） */
function currentQuota(): Quota | null {
	if (!quota) return null;
	if (Date.now() - quotaAt > QUOTA_TTL_MS) {
		quota = null;
		quotaAt = 0;
		return null;
	}
	return quota;
}

function join(parts: (string | undefined)[], separator: string): string {
	return parts.filter((part): part is string => Boolean(part && part.length > 0)).join(separator);
}

export default function (pi: ExtensionAPI) {
	const rerender = () => tuiRef?.requestRender();

	let lastRender = 0;
	const throttledRender = () => {
		const now = Date.now();
		if (now - lastRender < 80) return;
		lastRender = now;
		rerender();
	};

	pi.on("before_provider_request", async () => {
		requestStartAt = Date.now();
		firstChunkAt = null;
		liveChars = 0;
		liveOutput = 0;
		streamingTps = null;
	});

	pi.on("after_provider_response", async (event) => {
		const next = readQuota(event.headers ?? {});
		if (!next) return;
		quota = next;
		quotaAt = Date.now();
	});

	pi.on("message_update", async (event) => {
		if (event.message.role !== "assistant") return;
		const assistantEvent = event.assistantMessageEvent as AssistantMessageEvent | undefined;
		if (firstChunkAt === null) firstChunkAt = Date.now();

		if (assistantEvent) {
			const delta = (assistantEvent as { delta?: unknown }).delta;
			if (typeof delta === "string") liveChars += delta.length;
			const partialOutput = (assistantEvent as { partial?: { usage?: { output?: number } } }).partial?.usage?.output;
			if (typeof partialOutput === "number" && partialOutput > liveOutput) liveOutput = partialOutput;
		}

		const elapsed = (Date.now() - firstChunkAt) / 1000;
		if (elapsed > 0.4) {
			const tokensSoFar = liveOutput > 0 ? liveOutput : liveChars / CHARS_PER_TOKEN;
			if (tokensSoFar > 0) streamingTps = tokensSoFar / elapsed;
		}
		throttledRender();
	});

	pi.on("message_end", async (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		const usage = (message as AssistantMessage).usage;
		const output = usage?.output && usage.output > 0 ? usage.output : Math.round(liveChars / CHARS_PER_TOKEN);
		const startedAt = firstChunkAt ?? requestStartAt;
		if (startedAt && output > 0) {
			const elapsed = (Date.now() - startedAt) / 1000;
			if (elapsed > 0.05) lastTps = output / elapsed;
		}
		streamingTps = null;
		rerender();
	});

	pi.on("agent_end", async () => {
		streamingTps = null;
		rerender();
	});

	pi.on("model_select", async () => {
		rerender();
	});

	const buildFooter = (ctx: ExtensionContext) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui;
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			const paintThinking = (level: string) => {
				const role = THINKING_ROLE[level] ?? "thinkingOff";
				return theme.fg(role, level);
			};

			const paintContext = (percent: number) => {
				if (percent > 90) return theme.fg("error", fmtPercent(percent));
				if (percent > 70) return theme.fg("warning", fmtPercent(percent));
				return theme.fg("success", fmtPercent(percent));
			};

			const paintQuota = (value: Quota) => {
				if (value.kind === "requests") {
					const ratio = value.remaining / value.limit;
					const role = ratio <= 0.1 ? "error" : ratio <= 0.25 ? "warning" : "muted";
					return theme.fg(role, `${value.label} ${value.remaining}/${value.limit}`);
				}
				const role = value.percent >= 90 ? "error" : value.percent >= 70 ? "warning" : "muted";
				return theme.fg(role, `${value.label} ${fmtPercent(value.percent)}`);
			};

			const bar = (percent: number, cells = BAR_CELLS) => {
				const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)));
				const role = percent > 90 ? "error" : percent > 70 ? "warning" : "accent";
				const on = filled > 0 ? theme.fg(role, "█".repeat(filled)) : "";
				const off = cells - filled > 0 ? theme.fg("dim", "░".repeat(cells - filled)) : "";
				return on + off;
			};

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					const model = ctx.model;
					const modelLabel = theme.bold(
						theme.fg("accent", model?.name && model.name !== model.id ? model.name : (model?.id ?? "no-model")),
					);
					const level = ctx.thinkingLevel ?? "off";
					const thinkingLabel = model?.reasoning === false ? undefined : paintThinking(level);
					const providerLabel = theme.fg("dim", `(${model?.provider ?? "?"})`);

					const usage = ctx.getContextUsage();
					const window = usage?.contextWindow ?? model?.contextWindow ?? 0;
					const percent = usage?.percent ?? null;
					const tokens = usage?.tokens ?? null;

					const dot = theme.fg("dim", " · ");
					const separator = theme.fg("dim", " │ ");

					// ── 左栏：上下文 · 分支 · 速度 ──────────────────────────
					const contextDetail =
						percent === null
							? theme.fg("dim", `?/${fmtTokens(window)}`)
							: join(
									[
										bar(percent),
										paintContext(percent),
										theme.fg("dim", tokens === null ? fmtTokens(window) : `${fmtTokens(tokens)}/${fmtTokens(window)}`),
									],
									" ",
								);

					const contextCompact =
						percent === null ? theme.fg("dim", `?/${fmtTokens(window)}`) : join([bar(percent), paintContext(percent)], " ");

					const branch = footerData.getGitBranch();
					const branchLabel = branch ? theme.fg("muted", `⎇ ${shortenBranch(branch)}`) : undefined;

					const speedValue = streamingTps ?? lastTps;
					const speedLabel =
						speedValue !== null && Number.isFinite(speedValue)
							? theme.fg(streamingTps !== null ? "accent" : "muted", `${speedValue.toFixed(0)}t/s`)
							: undefined;

					const leftFull = join([contextDetail, branchLabel, speedLabel], dot);
					const leftCompact = join([contextCompact, branchLabel, speedLabel], dot);
					const leftNoBranch = join([contextDetail, speedLabel], dot);
					const leftNoSpeed = join([contextDetail, branchLabel], dot);
					const leftMini = contextCompact;

					// ── 右栏：模型 · 思考强度 · 供应商 · 额度 ────────────────
					const activeQuota = currentQuota();
					const quotaLabel = activeQuota ? paintQuota(activeQuota) : undefined;

					// 供应商在模型左边
					const rightFull = join([providerLabel, modelLabel, thinkingLabel, quotaLabel], dot);
					const rightNoQuota = join([providerLabel, modelLabel, thinkingLabel], dot);
					const rightNoProvider = join([modelLabel, thinkingLabel], dot);
					const rightModel = modelLabel;

					const build = (leftSide: string, right: string) => {
						const leftWidth = visibleWidth(leftSide);
						const rightWidth = visibleWidth(right);
						if (leftWidth + 2 + rightWidth > width) return null;
						const pad = " ".repeat(Math.max(2, width - leftWidth - rightWidth));
						return truncateToWidth(leftSide + pad + right, width);
					};

					const attempts: (string | null)[] = [
						build(leftFull, rightFull),
						build(leftFull, rightNoQuota),
						build(leftCompact, rightNoQuota),
						build(leftNoBranch, rightNoQuota),
						build(leftNoSpeed, rightNoQuota),
						build(leftNoBranch, rightNoProvider),
						build(leftNoSpeed, rightNoProvider),
						build(leftMini, rightNoProvider),
						build(leftMini, rightModel),
						truncateToWidth(join([leftMini, rightModel], separator), width),
					];

					for (const line of attempts) {
						if (line) return [line];
					}

					// 极窄：拆两行，左栏在上、右栏右对齐在下
					const rightWidth = visibleWidth(rightFull);
					const leftLine = truncateToWidth(leftCompact, width);
					const rightLine =
						rightWidth <= width
							? " ".repeat(width - rightWidth) + rightFull
							: truncateToWidth(rightFull, width);
					return [leftLine, rightLine];
				},
			};
		});
	};

	// session_start 在 buildFooter 定义之后再注册（避免 TDZ）
	pi.on("session_start", async (_event, ctx) => {
		resetSessionState();
		if (ctx.mode !== "tui" || !renderEnabled) return;
		buildFooter(ctx);
	});

	pi.registerCommand("statusline", {
		description: "开关自定义状态栏",
		handler: async (_args, ctx) => {
			renderEnabled = !renderEnabled;
			if (renderEnabled) {
				buildFooter(ctx);
				ctx.ui.notify("状态栏: 开启", "info");
				return;
			}
			tuiRef = null;
			ctx.ui.setFooter(undefined);
			ctx.ui.notify("状态栏: 关闭（已恢复默认）", "info");
		},
	});
}
