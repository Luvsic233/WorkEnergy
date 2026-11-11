# 贡献指南

## 起开发环境

需要 Node ≥ 20 与 pnpm ≥ 9（本机实测 Node 24.21.0 / pnpm 11.28.5）。

```bash
pnpm install --store-dir .pnpm-store
pnpm dev            # http://localhost:5173（等价：node node_modules/vite/bin/vite.js）
```

`--store-dir .pnpm-store` 请一直带着：本机项目目录不允许建软链接，存储放进项目内才能硬链接安装。

只改前端时不需要 Rust 工具链。要跑桌面外壳（`src-tauri/`）时，本机得走 gnu 路线，步骤见 README 的"本机自举步骤"；CI 用 MSVC，不照搬本机这套。

## 代码分层约定

- **core 层（`src/core/`）禁止浮点**：金额与时长的计算只用 `bigint` 与整数 `number`（毫秒、分钟）。不出现 `parseFloat`、不出现把金额塞进 `Number` 再算的写法——精度会一路塌掉。core 也不 import React、不碰 `window`/`localStorage`，保持纯函数，测试不需要环境搭台。
- **ui 层禁止每帧 setState**：requestAnimationFrame 回调里只允许读时间、算一次纯函数、写 `textContent`。`setState` 只用于真正改变结构的场景（打开设置面板、切换加班模式）。动画帧里让 React 参与协调会把 60fps 变成掉帧。
- **infra 层只依赖接口**：存储走 `src/settings/storage.ts` 的 `StorageAdapter`（`load()` / `save()`）。换后端（Tauri store 等）时只替换适配器实现，`core/settings.ts` 与面板组件不应被改动。
- **精度规则不许绕过**：`earnedAtoms` 的输入必须是整数 `paidMs`，不允许在 UI 层"每帧累加金额"。即使看起来更简单，也会重新引入漂移（`earning.test.ts` 里有反例测试守着）。
- **新增纯函数就要有测试**：现有 5 个测试文件 51 个用例，全部在 `src/**/*.test.ts`，`environment: node`，不依赖 DOM。ticker 通过注入 `now/schedule/cancel` 做到可测，新代码沿用同样的注入方式。

## 提 PR 前必须跑

```bash
pnpm test        # vitest run，必须全绿
pnpm typecheck   # tsc --noEmit，两套 tsconfig 都不能有输出
pnpm build       # tsc --noEmit && vite build，产物能出来
```

再顺手确认没有把本地产物提交上去：

```bash
git status --porcelain          # 不应出现 node_modules/、dist/、.pnpm-store/、.toolchain/
git diff --stat HEAD -- src/    # 只有你真正改的源码
```

`.toolchain/`（本机 Rust/MSYS2）与 `src-tauri/target/`（Rust 构建产物）已在 `.gitignore` 里，别用 `git add -f` 绕过。

## 提交信息

沿用现有 history 的风格：`type(scope): 一句话`，例如
`feat(settings): collapsible salary panel wired into the demo page`
`fix(floating-bar): render the settings hint from settings instead of hardcoded 10000/21.75/8`
type 用 feat / fix / test / docs / chore / ci。

## 发布

推一个 `v*` tag 即触发 `.github/workflows/release.yml`：跑单测与前端构建 → MSVC 编译 Tauri → 上传 exe 与 NSIS 安装包 → 建 GitHub Release。arm64 目前不构建。
