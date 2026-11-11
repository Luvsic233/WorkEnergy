import { DEFAULT_INPUT, type RawInput } from "../core/settings";

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
