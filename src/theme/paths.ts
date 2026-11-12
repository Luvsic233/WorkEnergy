/*
 * 主题目录的路径规则（唯一事实来源）。
 *
 * 真实运行时：%APPDATA%\com.workenergy.shell\themes\<主题目录>\theme.json
 * （Tauri 的 appDataDir = %APPDATA%\<identifier>，identifier 见 tauri.conf.json）。
 * 测试里不碰真实目录：根目录一律由调用方注入（见 load.ts / seed.ts 的 root 参数）。
 */

/** 主题根目录名。 */
export const THEMES_DIR_NAME = "themes";

/** 路径分隔符：Windows 下 \，其它平台 /。 */
function separatorOf(path: string): string {
  return path.includes("\\") ? "\\" : "/";
}

/** 拼接路径片段（不做规范化，只保证不出现重复分隔符、不丢分隔符）。 */
export function joinPath(base: string, ...parts: string[]): string {
  const separator = separatorOf(base);
  let result = base;
  for (const part of parts) {
    const trimmed = part.replace(/^[\\/]+|[\\/]+$/g, "");
    if (trimmed === "") continue;
    result = result.endsWith(separator) ? result + trimmed : result + separator + trimmed;
  }
  return result;
}

/** 应用数据目录 → 主题根目录。 */
export function themesRoot(appDataDir: string): string {
  return joinPath(appDataDir, THEMES_DIR_NAME);
}

/** 用户主题的图片绝对路径（前端只用它拼 asset:// 地址）。 */
export function themeAssetPath(baseDir: string, fileName: string): string {
  return joinPath(baseDir, fileName);
}
