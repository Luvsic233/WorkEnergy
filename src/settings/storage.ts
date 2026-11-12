import {
  DECIMALS_OPTIONS,
  DEFAULT_INPUT,
  DISPLAY_MODE_OPTIONS,
  REFRESH_HZ_OPTIONS,
  type DisplayMode,
  type RawInput,
  type RefreshHz,
} from "../core/settings";
import type { Decimals } from "../core/format";

/** 外壳波次（Tauri store / Neutralino storage）只需替换这个适配器的实现。 */
export interface StorageAdapter {
  load(): Promise<RawInput | null>;
  save(v: RawInput): Promise<void>;
}

/** 适配器依赖的最小存储能力，测试里用内存实现替换。 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEY = "workenergy.settings.v1";

function text(record: Record<string, unknown>, key: keyof RawInput, fallback: string): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function flag(record: Record<string, unknown>, key: keyof RawInput, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 枚举型字段：只有落在面板档位里的值才采用，别的（老版本、手改、类型不对）一律回落默认。
 * 小数位数的白名单就是 DECIMALS_OPTIONS = 18 / 12 / 6，默认 18；老记录里 12 / 6 仍是合法档位故保留原选择，
 * 不在白名单里的值（例如上一版的 3）回落 18。显示方式的白名单是 roll / jump，默认 roll。
 * 字符串型记录（"6" / "60"）不算命中档位，照样回落默认。
 */
function option<T extends number | string>(
  record: Record<string, unknown>,
  key: keyof RawInput,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = record[key];
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  return (allowed as readonly (number | string)[]).includes(value) ? (value as T) : fallback;
}

/** 老版本 / 缺字段 / 类型不对的记录一律补默认值，不让它把面板炸掉。 */
export function normalizeRawInput(value: unknown): RawInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    salary: text(record, "salary", DEFAULT_INPUT.salary),
    payDays: text(record, "payDays", DEFAULT_INPUT.payDays),
    hours: text(record, "hours", DEFAULT_INPUT.hours),
    workStart: text(record, "workStart", DEFAULT_INPUT.workStart),
    workEnd: text(record, "workEnd", DEFAULT_INPUT.workEnd),
    lunchEnabled: flag(record, "lunchEnabled", DEFAULT_INPUT.lunchEnabled),
    lunchStart: text(record, "lunchStart", DEFAULT_INPUT.lunchStart),
    lunchEnd: text(record, "lunchEnd", DEFAULT_INPUT.lunchEnd),
    overtimeMode: flag(record, "overtimeMode", DEFAULT_INPUT.overtimeMode),
    decimals: option<Decimals>(record, "decimals", DECIMALS_OPTIONS, DEFAULT_INPUT.decimals),
    refreshHz: option<RefreshHz>(record, "refreshHz", REFRESH_HZ_OPTIONS, DEFAULT_INPUT.refreshHz),
    displayMode: option<DisplayMode>(record, "displayMode", DISPLAY_MODE_OPTIONS, DEFAULT_INPUT.displayMode),
  };
}

export function parseStored(json: string): RawInput | null {
  try {
    return normalizeRawInput(JSON.parse(json));
  } catch {
    return null;
  }
}

/** 每次调用都重新取 store，测试可以在运行中替换底层存储。 */
export function createAdapter(store: () => KeyValueStore | null): StorageAdapter {
  return {
    async load() {
      const target = store();
      if (!target) return null;
      const raw = target.getItem(STORAGE_KEY);
      return raw === null ? null : parseStored(raw);
    },
    async save(value) {
      const target = store();
      if (!target) throw new Error("当前环境没有可用的 localStorage");
      target.setItem(STORAGE_KEY, JSON.stringify(value));
    },
  };
}

function browserStore(): KeyValueStore | null {
  const candidate = (globalThis as { localStorage?: KeyValueStore }).localStorage;
  return candidate ?? null;
}

export const localStorageAdapter: StorageAdapter = createAdapter(browserStore);
