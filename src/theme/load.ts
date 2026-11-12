/*
 * 启动扫描：把主题根目录下的每个 <目录>/theme.json 读出来、校验、排序。
 *
 * 目录参数一律由调用方注入（真实运行时是 %APPDATA%\com.workenergy.shell\themes，
 * 单测里是内存实现 + 假路径），所以这段逻辑从不接触真实用户目录。
 */
import { buildCatalog, byDirectoryName, type Catalog } from "./catalog";
import type { ThemeIo } from "./io";
import { parseTheme } from "./parse";
import { joinPath } from "./paths";
import type { Theme } from "./types";

/** 每个主题目录里唯一的必需文件名。 */
export const THEME_FILE_NAME = "theme.json";

export interface ThemeScan {
  /** 已按目录名升序排列的用户主题（合法的那些）。 */
  themes: Theme[];
  /** 每个被忽略的主题一行说明。 */
  logs: string[];
}

/** 用户主题的稳定 id：user:<目录名>。 */
export function userThemeId(dirName: string): string {
  return `user:${dirName}`;
}

/**
 * 扫描主题根目录。非法主题不抛错、不中断扫描：只留一行日志然后继续下一个目录。
 * 排序在解析之前做（目录名升序），catalog.ts 的重名优先级就依赖这个顺序。
 */
export async function scanUserThemes(io: ThemeIo, root: string): Promise<ThemeScan> {
  const logs: string[] = [];
  let dirs: string[] = [];
  try {
    dirs = await io.listDirs(root);
  } catch {
    logs.push(`列出主题目录失败：${root}`);
  }

  const themes: Theme[] = [];
  for (const dir of [...new Set(dirs)].sort()) {
    let text: string | null = null;
    try {
      text = await io.readText(root, dir, THEME_FILE_NAME);
    } catch {
      text = null;
    }
    if (text === null) {
      logs.push(`跳过 ${dir}：读不到 ${THEME_FILE_NAME}`);
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      logs.push(`跳过 ${dir}：${THEME_FILE_NAME} 不是合法 JSON`);
      continue;
    }

    const { theme, issues } = parseTheme(raw, {
      id: userThemeId(dir),
      source: "user",
      dirName: dir,
      baseDir: joinPath(root, dir),
    });
    if (!theme) {
      logs.push(`跳过 ${dir}：${issues.join("；")}`);
      continue;
    }
    if (issues.length > 0) logs.push(`${dir}：${issues.join("；")}`);
    themes.push(theme);
  }

  return { themes, logs };
}

/** 扫描 + 合并内置主题：面板最终看到的那份清单。 */
export async function loadThemeCatalog(io: ThemeIo, root: string): Promise<Catalog & { logs: string[] }> {
  const scan = await scanUserThemes(io, root);
  const catalog = buildCatalog(scan.themes);
  const logs = [...scan.logs];
  for (const dir of catalog.dropped) logs.push(`跳过 ${dir}：显示名与已有主题重名`);
  return { ...catalog, logs };
}

/** 目录名升序导出，方便调用方对自定义来源的列表排序。 */
export { byDirectoryName };
