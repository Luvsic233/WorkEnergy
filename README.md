# WorkEnergy · 上班实时工资

一个 Vite + React + TypeScript 的悬浮条：用 BigInt 定点数实时计算"今天已经赚到多少钱"，12 位小数、60fps 只更新文本节点。

当前已完成前端核心（薪资引擎 + 悬浮条 + 演示页 + 薪资设置面板），**不含** Tauri/Rust 外壳、托盘、开机自启、真实存储后端。

## 快速开始

```bash
PNPM='node "C:\Users\zrd\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"'
eval $PNPM install --store-dir .pnpm-store
eval $PNPM dev      # http://localhost:5173
eval $PNPM test
eval $PNPM build
```

`--store-dir .pnpm-store` 是本机必需的工作区参数：这台 Windows 不允许在项目目录内创建目录符号链接，包存储必须落在项目目录里才能用硬链接完成安装。

## 金额为什么是 BigInt

`atoms = 1e-18 元`，全程整数，没有 `parseFloat`、没有 `Number` 参与计算：

- `salaryMicro = 月薪(元) × 1e6`，`payDaysMicro = 21.75 → 21750000n`，`hoursMicro = 8 → 8000000n`；
- `paidMs` 是整数毫秒，**先累加时间、再算钱**，所以"3600 次各 +1 秒"和"一次算 3600 秒"逐位相等；
- 反过来，如果按每帧的金额求和，整数截断会累积误差 —— 单测 `shows why atoms are derived from integer paidMs` 就是这条反例；
- 精度向量：月薪 10000、21.75 天、8 小时时，1 小时 = `(10000 × 1e18) / 174` atoms，即 57.471264367816091954 元。

## 结构

| 路径 | 作用 |
| --- | --- |
| `src/core/earning.ts` | 配置解析（字符串 → BigInt）、`paidMsOf`（在岗时长，纯函数）、`earnedAtoms`（金额定点） |
| `src/core/format.ts` | BigInt → 整数部分 + 12 位小数，绝不经过 Number |
| `src/ui/ticker.ts` | rAF 循环外壳，注入 `now/schedule/cancel` 以便单测 |
| `src/ui/FloatingBar.tsx` | 400×120 深色半透明悬浮条，每帧只写 `textContent`，不 `setState` |
| `src/App.tsx` | 演示页：加班模式 / 演示时钟开关 |

## 持久化适配层

- 输入存在 `localStorage` 的 `workenergy.settings.v1`，读写只经过 `src/settings/storage.ts` 的 `StorageAdapter`（`load()` / `save()`）。
- 外壳波次会换成 Tauri store / Neutralino storage，只替换该适配器，`settings.ts` 与面板组件不用改一行。
- 本波次没有第二种后端：拿不到 `localStorage` 时 `load()` 返回 `null`、`save()` 抛错，面板把原因显示在状态行里。

## 渲染纪律

`requestAnimationFrame` 回调里只做三件事：读 `Date.now()`、算一次纯函数、写三个 DOM 文本节点。React 在挂载时渲染一次，之后整条 bar 的跳动完全不经过 React 协调层；数字用 `tabular-nums` 避免字宽抖动。

## 已知边界

- v1 不支持跨夜班：下班时间 ≤ 上班时间视为配置错误，`isMisconfigured` 为真且金额为 0。
- 在岗时长按"当天本地时间"计算；跨天只做下班冻结，不做历史累计。
- `backdrop-filter` 需要有背景内容才看得出模糊；`body` 保持 `transparent`，为后续透明无边框桌面窗预留。

## License

MIT
