/*
 * 主题选择的持久化：和薪资设置分开一个键，两者互不影响。
 * 同步读（首帧前就要用），写失败静默 —— 存不下也不该拦住用户切主题。
 */
export const THEME_STORAGE_KEY = "workenergy.theme.v1";

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function store(): KeyValueStore | null {
  return (globalThis as { localStorage?: KeyValueStore }).localStorage ?? null;
}

/** 读已保存的主题 id；没有 / 坏数据一律返回 null（调用方回落默认主题）。 */
export function readStoredThemeId(): string | null {
  const raw = store()?.getItem(THEME_STORAGE_KEY) ?? null;
  if (raw === null) return null;
  const text = raw.trim();
  return text === "" ? null : text;
}

/** 保存主题 id（立即生效靠调用方同时改 CSS 变量，不依赖这里的落盘顺序）。 */
export function saveThemeId(id: string): void {
  try {
    store()?.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // 存储被禁 / 配额满：本次切换仍然生效，只是下次启动回到默认主题。
  }
}
