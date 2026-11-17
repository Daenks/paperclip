import type { ProviderQuotaResult, QuotaWindow } from "@paperclipai/plugin-sdk";

export const SNAPSHOT_STATE_KEY = "usage-snapshot";
export const ALERTS_STATE_KEY = "usage-alerts";
export const USAGE_TOOL_NAME = "subscription_usage";
export const POLL_JOB_KEY = "poll-subscription-usage";
export const USAGE_SKILL_KEY = "subscription-usage-pacing";

export const DEFAULT_WARN_REMAINING_PERCENT = 25;
export const DEFAULT_CRITICAL_REMAINING_PERCENT = 10;

export type UsageLevel = "ok" | "warn" | "critical" | "unknown";
export type UsagePace = "under" | "on" | "over" | "unknown";
/**
 * `limit` windows cap all work on the account. `model` windows cap one model
 * family. `credit` windows are paid extras and never set the level.
 */
export type UsageWindowKind = "limit" | "model" | "credit";

export interface UsageThresholds {
  warnRemainingPercent: number;
  criticalRemainingPercent: number;
}

export interface UsageWindow {
  label: string;
  kind: UsageWindowKind;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  /** Share of the window's time that has passed, when its length is known. */
  elapsedPercent: number | null;
  pace: UsagePace;
  level: UsageLevel;
  valueLabel: string | null;
}

export interface UsageAccount {
  provider: string;
  accountLabel: string | null;
  ok: boolean;
  errorFamily: string | null;
  capturedAt: string | null;
  level: UsageLevel;
  windows: UsageWindow[];
}

export interface UsageSnapshot {
  companyId: string;
  capturedAt: string;
  level: UsageLevel;
  thresholds: UsageThresholds;
  accounts: UsageAccount[];
}

const LEVEL_ORDER: Record<UsageLevel, number> = { unknown: 0, ok: 1, warn: 2, critical: 3 };

export function worstLevel(levels: UsageLevel[]): UsageLevel {
  const known = levels.filter((level) => level !== "unknown");
  if (known.length === 0) return "unknown";
  return known.reduce((worst, level) => (LEVEL_ORDER[level] > LEVEL_ORDER[worst] ? level : worst));
}

function percentSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
}

export function readThresholds(config: Record<string, unknown>): UsageThresholds {
  const warn = percentSetting(config.warnRemainingPercent, DEFAULT_WARN_REMAINING_PERCENT);
  const critical = percentSetting(config.criticalRemainingPercent, DEFAULT_CRITICAL_REMAINING_PERCENT);
  // A critical threshold above the warning one would skip the warning level.
  return { warnRemainingPercent: Math.max(warn, critical), criticalRemainingPercent: critical };
}

export function readAlertAgentId(config: Record<string, unknown>): string | null {
  return typeof config.alertAgentId === "string" && config.alertAgentId.trim() ? config.alertAgentId.trim() : null;
}

function windowKind(label: string): UsageWindowKind {
  if (/credit|extra usage/i.test(label)) return "credit";
  if (/\bonly\b/i.test(label)) return "model";
  return "limit";
}

/** Window length in hours, read from the provider's label. Null when the label does not say. */
function windowHours(label: string): number | null {
  const explicit = /(\d+)\s*([hd])\b/i.exec(label);
  if (explicit) return Number(explicit[1]) * (explicit[2].toLowerCase() === "d" ? 24 : 1);
  if (/session/i.test(label)) return 5;
  if (/week/i.test(label)) return 7 * 24;
  return null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function describeWindow(window: QuotaWindow, thresholds: UsageThresholds, now: number): UsageWindow {
  const kind = windowKind(window.label);
  const usedPercent = typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent)
    ? clampPercent(window.usedPercent)
    : null;
  const remainingPercent = usedPercent === null ? null : Math.round((100 - usedPercent) * 10) / 10;

  let elapsedPercent: number | null = null;
  const hours = windowHours(window.label);
  const resetsAtMs = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  if (hours !== null && Number.isFinite(resetsAtMs)) {
    const lengthMs = hours * 3_600_000;
    elapsedPercent = Math.round(clampPercent(((lengthMs - (resetsAtMs - now)) / lengthMs) * 100) * 10) / 10;
  }

  let pace: UsagePace = "unknown";
  if (usedPercent !== null && elapsedPercent !== null) {
    const lead = usedPercent - elapsedPercent;
    pace = lead > 10 ? "over" : lead < -10 ? "under" : "on";
  }

  let level: UsageLevel = "unknown";
  if (kind !== "credit" && remainingPercent !== null) {
    level = remainingPercent <= thresholds.criticalRemainingPercent
      ? "critical"
      : remainingPercent <= thresholds.warnRemainingPercent ? "warn" : "ok";
  }

  return {
    label: window.label,
    kind,
    usedPercent,
    remainingPercent,
    resetsAt: Number.isFinite(resetsAtMs) ? new Date(resetsAtMs).toISOString() : null,
    elapsedPercent,
    pace,
    level,
    valueLabel: window.valueLabel ?? null,
  };
}

export function buildSnapshot(
  companyId: string,
  results: ProviderQuotaResult[],
  thresholds: UsageThresholds,
  now = Date.now(),
): UsageSnapshot {
  const accounts = results.map((result): UsageAccount => {
    const windows = result.ok ? result.windows.map((window) => describeWindow(window, thresholds, now)) : [];
    return {
      provider: result.provider,
      accountLabel: result.accountLabel ?? null,
      ok: result.ok,
      errorFamily: result.ok ? null : result.errorFamily ?? "provider_unavailable",
      capturedAt: result.capturedAt ?? null,
      // A model-only window does not stop work on other models, so it does not set the account level.
      level: worstLevel(windows.filter((window) => window.kind === "limit").map((window) => window.level)),
      windows,
    };
  });
  return {
    companyId,
    capturedAt: new Date(now).toISOString(),
    level: worstLevel(accounts.map((account) => account.level)),
    thresholds,
    accounts,
  };
}

function formatReset(resetsAt: string | null, now: number): string {
  if (!resetsAt) return "reset time not reported";
  const minutes = Math.round((Date.parse(resetsAt) - now) / 60_000);
  if (minutes <= 0) return "resets now";
  if (minutes < 90) return `resets in ${minutes} min`;
  const hours = minutes / 60;
  return hours < 48 ? `resets in ${Math.round(hours)} h` : `resets in ${Math.round(hours / 24)} days`;
}

const PACE_TEXT: Record<UsagePace, string> = {
  over: "being used faster than the window passes",
  on: "being used about as fast as the window passes",
  under: "being used slower than the window passes",
  unknown: "",
};

const LEVEL_ADVICE: Record<UsageLevel, string> = {
  ok: "Quota is healthy. Work normally.",
  warn: "Quota is getting low. Finish what is in progress, prefer high-priority work, and avoid starting large optional work before the reset.",
  critical: "Quota is nearly used up. Do only urgent or high-priority work. Leave everything else for after the reset and say so on the task.",
  unknown: "Quota could not be read. Work normally, and do not assume there is plenty left.",
};

export function accountName(account: Pick<UsageAccount, "provider" | "accountLabel">): string {
  return account.accountLabel ? `${account.accountLabel} (${account.provider})` : account.provider;
}

/** Plain-text summary for an agent. */
export function describeSnapshot(snapshot: UsageSnapshot, now = Date.now()): string {
  const lines = [`Shared subscription quota: ${snapshot.level}. ${LEVEL_ADVICE[snapshot.level]}`];
  for (const account of snapshot.accounts) {
    if (!account.ok) {
      lines.push(`- ${accountName(account)}: not available (${account.errorFamily}).`);
      continue;
    }
    lines.push(`- ${accountName(account)}: ${account.level}`);
    for (const window of account.windows) {
      const amount = window.remainingPercent === null
        ? window.valueLabel ?? "not reported"
        : `${window.remainingPercent}% left`;
      const parts = [amount, formatReset(window.resetsAt, now)];
      if (window.pace !== "unknown") parts.push(PACE_TEXT[window.pace]);
      if (window.kind === "model") parts.push("applies to that model only");
      if (window.kind === "credit") parts.push("paid extra, does not set the level");
      lines.push(`  - ${window.label}: ${parts.join("; ")}`);
    }
  }
  lines.push(
    `Levels: warn at ${snapshot.thresholds.warnRemainingPercent}% left or less, critical at ${snapshot.thresholds.criticalRemainingPercent}% left or less.`,
  );
  return lines.join("\n");
}

export interface AlertRecord {
  level: "warn" | "critical";
  resetsAt: string | null;
}

export type AlertRecords = Record<string, AlertRecord>;

export interface UsageAlert {
  key: string;
  account: string;
  window: UsageWindow;
}

export function readAlertRecords(value: unknown): AlertRecords {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const records: AlertRecords = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const { level, resetsAt } = entry as Record<string, unknown>;
    if (level !== "warn" && level !== "critical") continue;
    records[key] = { level, resetsAt: typeof resetsAt === "string" ? resetsAt : null };
  }
  return records;
}

const NEW_WINDOW_GAP_MS = 60 * 60_000;

function isNewWindow(previous: string | null, current: string | null): boolean {
  if (!previous || !current) return false;
  return Date.parse(current) - Date.parse(previous) > NEW_WINDOW_GAP_MS;
}

/**
 * Decides which windows need an alert now. A window alerts once when it
 * reaches a level, again if it gets worse, and again in a later window.
 * Windows back at `ok` are forgotten so the next drop alerts again.
 */
export function planAlerts(
  snapshot: UsageSnapshot,
  previous: AlertRecords,
): { alerts: UsageAlert[]; records: AlertRecords } {
  const alerts: UsageAlert[] = [];
  const records: AlertRecords = {};
  for (const account of snapshot.accounts) {
    if (!account.ok) {
      // Keep what is known about this account until it can be read again.
      const prefix = `${account.provider}|${account.accountLabel ?? ""}|`;
      for (const [key, record] of Object.entries(previous)) if (key.startsWith(prefix)) records[key] = record;
      continue;
    }
    for (const window of account.windows) {
      if (window.kind !== "limit" || (window.level !== "warn" && window.level !== "critical")) continue;
      const key = `${account.provider}|${account.accountLabel ?? ""}|${window.label}`;
      const before = previous[key];
      const worse = !before || LEVEL_ORDER[window.level] > LEVEL_ORDER[before.level];
      if (worse || isNewWindow(before.resetsAt, window.resetsAt)) {
        alerts.push({ key, account: accountName(account), window });
        records[key] = { level: window.level, resetsAt: window.resetsAt };
      } else {
        records[key] = before;
      }
    }
  }
  return { alerts, records };
}

export function describeAlerts(alerts: UsageAlert[], snapshot: UsageSnapshot, now = Date.now()): string {
  const lines = alerts.map((alert) =>
    `- ${alert.account}, ${alert.window.label}: ${alert.window.level}, ${alert.window.remainingPercent}% left, ${formatReset(alert.window.resetsAt, now)}`);
  return [
    "The company's shared AI subscription quota is running low.",
    ...lines,
    "",
    "Decide whether work should be slowed, reordered or paused until the reset, and tell the agents or the board as your role requires. Full status:",
    "",
    describeSnapshot(snapshot, now),
  ].join("\n");
}
