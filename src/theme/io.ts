/*
 * 主题目录的读写能力（可注入）。
 *
 * 三个实现：
 * - tauriThemeIo：真实运行时，用 Tauri 的 fs 插件命令读 / 写 %APPDATA%\com.workenergy.shell\themes；
 * - memoryThemeIo：单测用，纯内存"文件树"，绝不在真实 %APPDATA% 里造垃圾；
 * - unavailableThemeIo：浏览器预览等没有磁盘能力的环境，一律按"没有用户主题"处理（降级为只读内置主题）。
 *
 * 每个方法都不抛错：读不到 / 写不了就返回 null / false，调用方据此留一行日志并继续跑。
 */
import { THEMES_DIR_NAME, joinPath } from "./paths";

/** 主题根目录下的最小读写接口。root 由调用方注入（真实路径或测试里的假路径）。 */
export interface ThemeIo {
  /** 列出根目录下的子目录名；根目录不存在返回 []。 */
  listDirs(root: string): Promise<string[]>;
  /** 读 <root>/<dir>/<file> 的文本；不存在 / 不可读返回 null。 */
  readText(root: string, dir: string, file: string): Promise<string | null>;
  /** 写 <root>/<dir>/<file>（目录不存在时一并创建）；成功返回 true。 */
  writeText(root: string, dir: string, file: string, content: string): Promise<boolean>;
}

const logged = new Set<string>();

/** 同一类问题只记一次：每个主题各刷一行日志会把控制台淹掉。 */
export function logTheme(message: string, key = message): void {
  if (logged.has(key)) return;
  logged.add(key);
  console.info(`[theme] ${message}`);
}

/** 什么都没有的环境（浏览器预览）：用户主题目录不可用。 */
export const unavailableThemeIo: ThemeIo = {
  async listDirs() {
    return [];
  },
  async readText() {
    return null;
  },
  async writeText() {
    return false;
  },
};

/** 内存实现：tree 的键是 "<dir>/<file>"，写入会记在 writes 里供单测断言。 */
export interface MemoryThemeIo extends ThemeIo {
  tree: Record<string, string>;
  writes: string[];
}

export function createMemoryThemeIo(tree: Record<string, string> = {}): MemoryThemeIo {
  const memory: MemoryThemeIo = {
    tree: { ...tree },
    writes: [],
    async listDirs() {
      const dirs = new Set<string>();
      for (const key of Object.keys(memory.tree)) {
        const slash = key.indexOf("/");
        if (slash > 0) dirs.add(key.slice(0, slash));
      }
      return [...dirs];
    },
    async readText(_root, dir, file) {
      return memory.tree[`${dir}/${file}`] ?? null;
    },
    async writeText(_root, dir, file, content) {
      const key = `${dir}/${file}`;
      memory.tree[key] = content;
      memory.writes.push(key);
      return true;
    },
  };
  return memory;
}

/*
 * Tauri 真机实现。
 *
 * 说明（重要，写在这里以免下次又踩）：本波允许改动的 src-tauri 部分只有 capabilities/default.json
 * 与 tauri.conf.json 的 app.security，Rust 侧（Cargo.toml / src-tauri/src）不许动，所以
 * tauri-plugin-fs 现在并不在壳里。下面这套命令形状是 Tauri v2 的 fs 插件 IPC，
 * 只有等外壳注册了 tauri-plugin-fs 并在 capability 里放了 fs: 权限之后才会真正生效；
 * 在此之前每次调用都会失败，被 catch 住并只留一行日志，应用照常只显示内置主题。
 */
interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface TauriGlobal {
  core?: {
    invoke?: InvokeFn;
    convertFileSrc?: (path: string) => string;
  };
  path?: {
    appDataDir?: () => Promise<string>;
  };
}

function runtime(): TauriGlobal | undefined {
  return (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
}

/** 是否运行在 Tauri 壳里（浏览器预览为 false）。 */
export function hasShell(): boolean {
  return typeof runtime()?.core?.invoke === "function";
}

/** 应用数据目录（%APPDATA%\com.workenergy.shell）；浏览器里返回 null。 */
export async function appDataDirOf(): Promise<string | null> {
  const api = runtime()?.path;
  if (!api?.appDataDir) return null;
  try {
    const dir = await api.appDataDir();
    return typeof dir === "string" && dir !== "" ? dir : null;
  } catch {
    return null;
  }
}

interface DirEntry {
  name?: unknown;
  isDirectory?: unknown;
}

export const tauriThemeIo: ThemeIo = {
  async listDirs(root) {
    const invoke = runtime()?.core?.invoke;
    if (!invoke) return [];
    try {
      const entries = await invoke("plugin:fs|read_dir", { path: root, options: {} });
      if (!Array.isArray(entries)) return [];
      return (entries as DirEntry[])
        .filter((entry) => entry?.isDirectory !== false && typeof entry.name === "string")
        .map((entry) => String(entry.name));
    } catch {
      logTheme("读不到用户主题目录（外壳未启用 fs 能力），只加载内置主题", "list-dirs");
      return [];
    }
  },

  async readText(root, dir, file) {
    const invoke = runtime()?.core?.invoke;
    if (!invoke) return null;
    try {
      const text = await invoke("plugin:fs|read_text_file", {
        path: joinPath(root, dir, file),
        options: {},
      });
      return typeof text === "string" ? text : null;
    } catch {
      return null;
    }
  },

  async writeText(root, dir, file, content) {
    const invoke = runtime()?.core?.invoke;
    if (!invoke) return false;
    const dirPath = joinPath(root, dir);
    try {
      await invoke("plugin:fs|mkdir", { path: dirPath, options: { recursive: true } });
      await invoke("plugin:fs|write_text_file", {
        path: joinPath(dirPath, file),
        data: Array.from(new TextEncoder().encode(content)),
      });
      return true;
    } catch {
      logTheme(`写不进主题目录 ${THEMES_DIR_NAME}（外壳未启用 fs 能力），跳过空壳写入`, "write-theme");
      return false;
    }
  },
};

/** 按运行环境选一个实现：Tauri 里用真机实现，其它环境一律"没有用户主题"。 */
export function createThemeIo(): ThemeIo {
  return hasShell() ? tauriThemeIo : unavailableThemeIo;
}

/**
 * 「打开主题文件夹」：调用外壳的 opener 命令把资源管理器打开在主题根目录。
 * 浏览器里没有任何动作（按钮点了不报错，这是约定好的降级）。
 * 注意：tauri-plugin-opener 同样属于 Rust 侧的依赖，本波不许加；命令不存在时这里静默失败。
 */
export async function openThemeFolder(root: string | null): Promise<void> {
  if (!root) return;
  const invoke = runtime()?.core?.invoke;
  if (!invoke) return;
  try {
    await invoke("plugin:opener|open_path", { path: root });
  } catch {
    logTheme("外壳没有打开文件夹的命令（tauri-plugin-opener 未启用），按钮本次为 no-op", "open-folder");
  }
}

/** 把主题目录里的图片转成 asset:// 地址（浏览器里返回 null，吉祥物优雅不显示）。 */
export function toAssetUrl(path: string): string | null {
  const convert = runtime()?.core?.convertFileSrc;
  if (typeof convert !== "function") return null;
  try {
    return convert(path);
  } catch {
    return null;
  }
}
