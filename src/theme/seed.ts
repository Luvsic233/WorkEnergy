/*
 * 首次启动的空壳：用户主题目录为空时，写一个「耄耋猫」目录进去。
 *
 * 触发条件：启动扫描前，themes 根目录下没有任何子目录（列出为空 / 根目录还不存在）。
 * 目录里只有 theme.json 与 README.md —— 一只猫图都没有，本项目不分发任何第三方表情包素材；
 * 图片缺失时吉祥物区域整块不渲染（见 Mascot.tsx），主题本身照常可用。
 */
import type { ThemeIo } from "./io";

/** 空壳主题的目录名。 */
export const MAODIE_DIR = "maodie";

const MAODIE_THEME = {
  name: "耄耋猫",
  colors: {
    bar: "rgba(247, 240, 227, 0.92)",
    border: "rgba(120, 72, 30, 0.18)",
    label: "rgba(138, 107, 79, 0.9)",
    int: "#c2601f",
    frac: "#d98a3f",
    unit: "rgba(176, 138, 99, 0.92)",
    dot: "#c2601f",
    phase: "rgba(122, 91, 63, 0.85)",
    hint: "rgba(160, 132, 100, 0.8)",
  },
  font: '"Segoe UI", system-ui, sans-serif',
  mascot: {
    idle: "kitty-idle.webp",
    offwork: "kitty-offwork.webp",
    overtime: "kitty-overtime.webp",
    milestone: "kitty-happy.webp",
  },
};

export const MAODIE_THEME_JSON = `${JSON.stringify(MAODIE_THEME, null, 2)}\n`;

export const MAODIE_README = `# 耄耋猫主题（空壳）

把你自己的图片按下面的文件名放进这个目录，重启应用即可生效：

| 文件名 | 什么时候显示 |
| --- | --- |
| kitty-idle.webp | 在岗（含午休、未到上班时间） |
| kitty-offwork.webp | 已下班（画面冻结） |
| kitty-overtime.webp | 加班模式 |
| kitty-happy.webp | 金额每跨过一个整数元，显示约 1.5 秒后回到当前状态 |

说明：

- 本项目**不分发任何第三方表情包素材**，所以这个目录里只有 theme.json 与这份说明，没有图片。
- 缺少某个文件时，该状态会退到 kitty-idle.webp；四个文件都没有时，吉祥物区域整块不显示，
  数字区排版不受影响。
- 颜色的键都可以改（bar / border / label / int / frac / unit / dot / phase / hint），
  支持 #rgb、#rrggbb、#rrggbbaa、rgb()/rgba()/hsl()/hsla() 与 CSS 关键字；写错的那一项会回退默认值。
- font 是字体族（可选）。name 是显示名，必填。
`;

/** 空壳目录里的全部文件。没有任何图片 —— 故意的。 */
export const MAODIE_FILES: Readonly<Record<string, string>> = {
  "theme.json": MAODIE_THEME_JSON,
  "README.md": MAODIE_README,
};

export interface SeedResult {
  /** 真的写入了（或者根目录里已经有东西而跳过时为 false）。 */
  seeded: boolean;
  logs: string[];
}

/** 主题根目录为空时写入空壳；非空一律不动（用户自己的目录不会被我们覆盖）。 */
export async function seedThemesIfEmpty(io: ThemeIo, root: string): Promise<SeedResult> {
  let dirs: string[] = [];
  try {
    dirs = await io.listDirs(root);
  } catch {
    return { seeded: false, logs: [`列出主题目录失败，跳过空壳写入：${root}`] };
  }
  if (dirs.length > 0) return { seeded: false, logs: [] };

  const logs: string[] = [];
  let seeded = true;
  for (const [file, content] of Object.entries(MAODIE_FILES)) {
    const written = await io.writeText(root, MAODIE_DIR, file, content);
    if (!written) {
      seeded = false;
      logs.push(`写入 ${MAODIE_DIR}/${file} 失败`);
    }
  }
  return { seeded, logs };
}
