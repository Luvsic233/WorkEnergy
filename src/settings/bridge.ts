/**
 * Tauri 运行时桥。
 *
 * 原生侧通过 `app.withGlobalTauri` 注入 window.__TAURI__（不引入额外 npm 依赖），
 * 这里把它收成三个窄接口。浏览器里（例如静态预览服务器）没有 __TAURI__，
 * 全部退化成 no-op，前端在纯网页环境下照常渲染。
 */
type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriGlobal {
  core?: { invoke?: InvokeFn };
  event?: {
    emit?: (event: string, payload?: unknown) => Promise<unknown>;
    listen?: (
      event: string,
      handler: (event: { payload: unknown }) => void,
    ) => Promise<() => void>;
  };
}

function runtime(): TauriGlobal | undefined {
  return (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
}

/** 是否运行在 Tauri 壳里（浏览器预览时为 false）。 */
export function isDesktop(): boolean {
  return typeof runtime()?.core?.invoke === "function";
}

/** 调自定义命令；不在 Tauri 里或失败时静默，不影响纯网页预览。 */
export async function invoke(command: string): Promise<void> {
  const fn = runtime()?.core?.invoke;
  if (!fn) return;
  try {
    await fn(command);
  } catch {
    // 原生侧不可用（预览 / 命令被拒）时不需要打扰用户。
  }
}

/** 广播一个事件给所有窗口（设置窗口保存后通知悬浮条刷新）。 */
export async function emit(name: string): Promise<void> {
  const fn = runtime()?.event?.emit;
  if (!fn) return;
  try {
    await fn(name);
  } catch {
    // 同上。
  }
}

/** 订阅事件，返回取消订阅函数；不在 Tauri 里时返回 no-op。 */
export async function listen(name: string, handler: () => void): Promise<() => void> {
  const fn = runtime()?.event?.listen;
  if (!fn) return () => undefined;
  try {
    return await fn(name, () => handler());
  } catch {
    return () => undefined;
  }
}
