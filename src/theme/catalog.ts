/*
 * 主题目录 + 内置主题 → 面板里可选的主题清单。
 *
 * 重名优先级规则（写死在这里，改动请连同注释一起改）：
 *   1. 内置主题永远优先：用户主题不能覆盖 default / minimal 的显示名，否则用户把
 *      themes\x\theme.json 里的 name 写成"极简"就能顶掉内置那套，插件化的边界会变得含糊；
 *   2. 用户主题之间重名时，目录名按 UTF-16 code unit 升序排序，靠前的目录胜出 ——
 *      这条规则与文件系统的枚举顺序无关（不同机器上 ReadDir 顺序不可靠，必须自己定序）；
 *   3. 落选的主题不报错，只在日志里留一行"同名被忽略"，用户能看出自己哪份没生效。
 */
import { BUILTIN_THEMES } from "./builtin";
import type { Theme } from "./types";

export interface Catalog {
  /** 内置主题在前（保持 BUILTIN_THEMES 的顺序），用户主题在后（按目录名升序）。 */
  themes: Theme[];
  /** 因为重名被丢弃的目录名，调用方合成日志。 */
  dropped: string[];
}

/** 目录名升序：code unit 比较，跨平台结果一致。 */
export function byDirectoryName(left: Theme, right: Theme): number {
  const a = left.dirName ?? left.id;
  const b = right.dirName ?? right.id;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** userThemes 必须是"已按目录名升序"的列表（scanUserThemes 保证）。 */
export function buildCatalog(userThemes: readonly Theme[] = []): Catalog {
  const themes: Theme[] = [...BUILTIN_THEMES];
  const takenNames = new Set(themes.map((theme) => theme.name));
  const takenIds = new Set(themes.map((theme) => theme.id));
  const dropped: string[] = [];

  for (const theme of userThemes) {
    if (takenNames.has(theme.name) || takenIds.has(theme.id)) {
      dropped.push(theme.dirName ?? theme.id);
      continue;
    }
    takenNames.add(theme.name);
    takenIds.add(theme.id);
    themes.push(theme);
  }

  return { themes, dropped };
}
