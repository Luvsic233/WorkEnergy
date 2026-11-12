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
 * 命令形状按 tauri-plugin-fs v2.7.1 的 commands.rs 实测核对（读是 ipc::Response → 字节，
 * 写是原始请求 + headers）；壳里已注册 tauri-plugin-fs，capability 把 scope 收窄到
 * $APPDATA/themes。任何一步失败都被 catch 住、只留一行日志，应用照常只显示内置主题。
 */
interface InvokeFn {
  (command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown>;
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

/**
 * 列出某个目录下的文件名（不含子目录）。photo-left 版式用它扫用户放图的那个目录。
 * 浏览器预览 / 权限没开 / 目录不存在一律返回 []：调用方据此退化成纯色块，不报错。
 */
export async function listDirFiles(dir: string): Promise<string[]> {
  const invoke = runtime()?.core?.invoke;
  if (!invoke) return [];
  try {
    const entries = await invoke("plugin:fs|read_dir", { path: dir, options: {} });
    if (!Array.isArray(entries)) return [];
    return (entries as DirEntry[])
      .filter((entry) => entry?.isDirectory !== true && typeof entry.name === "string")
      .map((entry) => String(entry.name));
  } catch {
    logTheme(`读不到图片目录 ${dir}（外壳未启用 fs 能力 / 目录不存在），左图退化为纯色块`, "list-photo-dir");
    return [];
  }
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
      const data = await invoke("plugin:fs|read_text_file", {
        path: joinPath(root, dir, file),
        options: {},
      });
      // 插件这条命令回的是原始字节（Rust 侧 ipc::Response → ArrayBuffer），不是 JSON 字符串。
      if (typeof data === "string") return data;
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : Array.isArray(data)
            ? Uint8Array.from(data as number[])
            : null;
      return bytes === null ? null : new TextDecoder().decode(bytes);
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
      // write_text_file 走"原始请求"：路径与选项在 headers 里，body 才是文件字节。
      // 写成 { path, data } 的 JSON 会报 "missing file path"（Rust 侧从 header 取路径）。
      await invoke("plugin:fs|write_text_file", new TextEncoder().encode(content), {
        headers: {
          path: encodeURIComponent(joinPath(dirPath, file)),
          options: JSON.stringify({ create: true }),
        },
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
 * 壳里已注册 tauri-plugin-opener（capability: opener:allow-open-path + $APPDATA/themes scope）；
 * 命令不存在时这里静默失败。
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
