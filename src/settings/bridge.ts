/**
 * Tauri 运行时桥。
 *
 * 原生侧通过 `app.withGlobalTauri` 注入 window.__TAURI__（不引入额外 npm 依赖），
 * 这里把它收成几个窄接口。浏览器里（例如静态预览服务器）没有 __TAURI__，
 * 全部退化成 no-op（尺寸档位只落 CSS），前端在纯网页环境下照常渲染。
 */
import { sizePresetSpec, type SizePreset, type SizePresetSpec } from "../core/settings";

type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface LogicalSizeCtor {
  new (width: number, height: number): unknown;
}

interface AppWindow {
  /** 窗口标签：原始命令兜底时要用它指明改哪个窗口。 */
  label?: string;
  setSize?: (size: unknown) => Promise<unknown>;
  /** v2：按住卡片拖动当前窗口（点击判定通过后由前端主动发起）。 */
  startDragging?: () => Promise<unknown>;
}

interface WindowApi {
  /** v2：取当前窗口（只缩放悬浮条窗口自己，设置窗口的 430x540 不受影响）。 */
  getCurrentWindow?: () => AppWindow;
  /** 部分版本的 dpi 类直接挂在 window 命名空间下。 */
  LogicalSize?: LogicalSizeCtor;
  /** v1 的当前窗口句柄。 */
  appWindow?: AppWindow;
}

interface TauriGlobal {
  core?: { invoke?: InvokeFn };
  event?: {
    emit?: (event: string, payload?: unknown) => Promise<unknown>;
    listen?: (
      event: string,
      handler: (event: { payload: unknown }) => void,
    ) => Promise<() => void>;
  };
  /** 部分版本把 dpi 类单独挂一个命名空间。 */
  dpi?: { LogicalSize?: LogicalSizeCtor };
  window?: WindowApi;
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

/**
 * 开始拖动当前窗口。
 *
 * 为什么不用 data-tauri-drag-region：Tauri 的拖拽区在 mousedown 当场就把控制权交给 OS 的
 * 窗口移动循环，webview 之后收不到 pointerup / mouseup / click（真机实测：一次真实点击只到
 * pointerdown + mousedown，松开事件一个都没有）。那样"按下→松开算点击"根本无从判定。
 * 改成：按下先只记录坐标，位移超过 4px 才调这里开始拖动 —— 点击与拖动于是能在同一块区域上区分。
 */
export function startDragging(): void {
  const api = runtime()?.window;
  const current = api?.getCurrentWindow?.() ?? api?.appWindow;
  if (typeof current?.startDragging === "function") {
    try {
      void Promise.resolve(current.startDragging()).catch(() => undefined);
    } catch {
      // 某些外壳里同步抛错：不打扰用户，松手后照常判定点击。
    }
    return;
  }
  // 兜底：直接发 plugin:window|start_dragging（与拖拽区脚本走同一条命令）。
  const invokeFn = runtime()?.core?.invoke;
  if (!invokeFn || !current?.label) return;
  void invokeFn("plugin:window|start_dragging", { label: current.label }).catch(() => undefined);
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

/** 落 CSS 这一半：档位属性 + 缩放系数。同步执行，所以第一帧画出来就已经是目标档的字号与间距。 */
function paintSize(preset: SizePreset): SizePresetSpec {
  const spec = sizePresetSpec(preset);
  const root = document.documentElement;
  root.dataset.sizePreset = preset;
  root.style.setProperty("--bar-scale", String(spec.scale));
  return spec;
}

/**
 * 把尺寸档位落到 DOM 与窗口（运行期切档走这里）。
 *
 * 顺序是有意为之：CSS 变量同步生效，窗口尺寸随后异步下发。于是任何瞬间只可能出现
 * "内容已经是小档、窗口还停在旧尺寸"，绝不会反过来出现大字号被塞进小窗口的裁切；
 * 没有 __TAURI__ 时这一半照旧生效，只是窗口不动。
 */
export function applySizePreset(preset: SizePreset): void {
  if (typeof document === "undefined") return;
  const spec = paintSize(preset);
  void setWindowSize(spec.width, spec.height);
}

/** 启动兜底：窗口尺寸 IPC 最长等这么久就照常显示，绝不因为原生侧沉默而留下空白窗口。 */
const STARTUP_REVEAL_MS = 150;

/**
 * 启动时用（React 挂载之前）：先藏住内容，等窗口尺寸真正落地（或 150ms 兜底超时）再显示。
 *
 * 窗口初值由 tauri.conf.json 定为 400x120，改成紧凑档要一次 IPC 才能缩到 300x80；
 * 若直接显示，会先看到一帧"大窗口里的紧凑排版"再突然收缩。藏住这一小段（通常只有几毫秒、
 * 且窗口本身无边框透明）换来"第一眼看到的就是最终尺寸"。任何路径都一定会显示：
 * 成功、失败、超时都会走到 reveal，窗口不会被卡在隐藏态。
 */
export function applyStartupSizePreset(preset: SizePreset): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.visibility = "hidden";
  const spec = paintSize(preset);

  const reveal = () => {
    root.style.visibility = "";
  };
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, STARTUP_REVEAL_MS);
  });
  void Promise.race([setWindowSize(spec.width, spec.height), timeout]).then(reveal, reveal);
}

/**
 * 改窗口逻辑尺寸。两条路径都失败就静默放弃（权限没开 / 纯网页预览 / 非 Windows 外壳），
 * CSS 缩放已经生效，用户至少拿到了小排版。返回前不抛错，调用方不需要 await。
 */
async function setWindowSize(width: number, height: number): Promise<void> {
  const api = runtime()?.window;
  if (!api) return;
  const current = api.getCurrentWindow?.() ?? api.appWindow;
  const LogicalSize = api.LogicalSize ?? runtime()?.dpi?.LogicalSize;

  if (current?.setSize && LogicalSize) {
    try {
      await current.setSize(new LogicalSize(width, height));
      return;
    } catch {
      // 落到下面的原始命令兜底。
    }
  }

  // 兜底：window 命名空间里拿不到 LogicalSize 时直接发 plugin:window|set_size，
  // 参数形状与官方 JS 实现一致（Logical 包一层，label 指明当前窗口）。
  const invokeFn = runtime()?.core?.invoke;
  if (!invokeFn || !current?.label) return;
  try {
    await invokeFn("plugin:window|set_size", {
      label: current.label,
      value: { Logical: { width, height } },
    });
  } catch {
    // 权限未开（core:window:allow-set-size）/ 外壳不支持：不打扰用户。
  }
}
