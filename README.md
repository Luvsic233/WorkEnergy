# WorkEnergy · 上班实时工资

常驻桌面的小挂件：实时显示"今天上班已经赚到多少钱"，金额精确到 12 位小数并逐帧跳动，全程 BigInt 定点运算、requestAnimationFrame 只写文本节点。

![截图](docs/screenshot.png)

> 截图占位：`docs/screenshot.png` 尚未入库。补图时把 PNG 放到 `docs/` 下，本行路径不用改。

## 功能

- **12 位小数实时跳动**：金额最小单位是 1 atom = 10⁻¹⁸ 元，界面取前 12 位；每帧只更新 DOM 文本节点，不触发 React 重渲染。
- **月薪自动 ÷21.75 ÷8**：默认按每月 21.75 个计薪日、每天 8 小时折算时薪，两个系数都能在设置面板里改。
- **午休扣除**：可开关的午休窗口，落在窗口内的时长不计薪。
- **下班冻结**：到点后金额停在当天总额，不再增长，阶段显示"已下班"。
- **加班模式**：打开后下班之后的时长继续累计，阶段显示"加班"。
- **设置面板**：月薪 / 计薪天数 / 日工时 / 上下班时间 / 午休起止 / 加班模式；输入即时校验，错误就地显示；配置持久化在 `localStorage` 的 `workenergy.settings.v1`。
- **托盘图标与开机自启**：待外壳波次补齐，当前版本只有窗口本体（见"已知限制"）。

## 快速开始

要求：Node ≥ 20（本机实测 Node 24.21.0）、pnpm ≥ 9（实测 11.28.5）。

```bash
pnpm install --store-dir .pnpm-store

# 开发预览，默认 http://localhost:5173（等价写法：node node_modules/vite/bin/vite.js）
pnpm dev

# 不经过 pnpm script 直接起 vite
node node_modules/vite/bin/vite.js

pnpm test        # vitest run：5 个测试文件 / 51 个用例
pnpm typecheck   # tsc --noEmit，应用与 node 两套 tsconfig
pnpm build       # tsc --noEmit && vite build → dist/
```

`--store-dir .pnpm-store` 建议一直带着：这台机器的项目目录不允许建目录符号链接，把 pnpm 的内容寻址存储放进项目内，安装才能走硬链接而不是复制。该目录已在 `.gitignore` 中。

### 命令验证状态（如实标注）

| 命令 | 作用 | 本轮是否实跑 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile --store-dir .pnpm-store` | 装依赖 | ✅ 跑过：`Already up to date`，退出码 0 |
| `pnpm dev` | dev server | ✅ 跑过：`VITE v8.3.7 ready in 277 ms`，`http://localhost:5173/` |
| `node node_modules/vite/bin/vite.js` | dev server（同上的直连写法） | ✅ 跑过，端口 5173 就绪 |
| `pnpm test` | 单测 | ✅ 跑过：5 files / 51 tests passed |
| `node node_modules/vitest/vitest.mjs run` | 单测（直连写法） | ✅ 跑过，结果同上 |
| `pnpm typecheck` | 类型检查 | ✅ 跑过：两套 tsconfig 均无输出、退出码 0 |
| `pnpm build` | 前端产物 | ✅ 跑过：`built in 137ms`，dist 下 index.html + js + css |
| `node node_modules/vite/bin/vite.js build` | 前端产物（直连写法） | ✅ 跑过，结果同上 |
| `pnpm exec tauri build` | 打 exe + NSIS 安装包 | ❌ **未在本机跑**：本机只有 gnu 工具链，且 `src-tauri/` 由外壳波次负责 |
| `.github/workflows/release.yml` 里的任何步骤 | CI 发布 | ❌ **未在 CI 上跑过**：本轮只做了本地 YAML 语法解析 |

## 桌面外壳：Tauri 2 与本机 gnu 工具链

前端可以独立跑（`vite`），外壳是 Tauri 2（`src-tauri/`，`tauri` 2.12.5），窗口无边框、透明、置顶、不入任务栏，bundle 目标为 NSIS。

### 为什么本机不用 MSVC

Windows 上 Rust 默认目标是 `x86_64-pc-windows-msvc`，它需要 **Visual Studio 生成工具 + Windows SDK** 装进系统目录，安装程序要求管理员权限。本机账户不在管理员组，MSVC 路线在安装器那一步就断了，所以本机走 **GNU 路线**：Rust 的 `x86_64-pc-windows-gnu` 目标 + 一套便携 MSYS2 里的 MinGW-w64 gcc 当链接器。整套工具链活在项目目录内（`.toolchain/`）、已被 `.gitignore` 排除、删掉不留痕。

**CI 不需要这套东西**：GitHub Actions 的 `windows-latest` 自带 MSVC，那边直接用官方 rustup，见"CI 与发布"。

### 本机自举步骤

落地后的目录形状：

```
.toolchain/
  rust/          # standalone 发行版解包：bin/rustc.exe、bin/cargo.exe、lib/、share/
  msys64/        # 便携 MSYS2：mingw64/bin 下有 gcc.exe / ld.exe / ar.exe
  cargo-home/  rustup-home/  rust-dist/  home/  tmp/  logs/  dl/
```

1. **取 standalone Rust（不要用 rustup 安装器）**：下载
   `https://static.rust-lang.org/dist/rust-1.89.0-x86_64-pc-windows-gnu.tar.xz`，
   解包后把其中的 `rust/` 目录放到 `.toolchain/rust/`。standalone 包不会去找 Visual Studio。
2. **取便携 MSYS2**：从 `https://github.com/msys2/msys2-installer/releases` 下载 `msys2-base-x86_64-*.tar.xz`，
   解包成 `.toolchain/msys64/`。不要在系统里安装 MSYS2，保持整套工具链可整体删除。
3. **只用 pacman 装编译器**（装进 mingw64 子环境，不装到系统路径）：
   ```bash
   .toolchain/msys64/usr/bin/bash.exe -lc "pacman -Syu --noconfirm"
   .toolchain/msys64/usr/bin/bash.exe -lc "pacman -S --noconfirm mingw-w64-x86_64-gcc"
   ```
4. **构建时把两套工具显式塞进 PATH**，并把 cargo/rustup 的家目录也圈在项目内：
   ```bash
   export CARGO_HOME="$PWD/.toolchain/cargo-home"
   export RUSTUP_HOME="$PWD/.toolchain/rustup-home"
   export PATH="$PWD/.toolchain/rust/bin:$PWD/.toolchain/msys64/mingw64/bin:$PATH"
   cd src-tauri && cargo build --release          # 或回到根目录 pnpm exec tauri build
   ```
   `mingw64/bin` 必须排在系统目录之前，否则会捡到系统里别的 `gcc`/`ld`。
5. **自检**（以下输出为本轮实测）：

   ```text
   $ .toolchain/rust/bin/rustc.exe -vV | grep host
   host: x86_64-pc-windows-gnu

   $ .toolchain/rust/bin/rustc.exe --version
   rustc 1.89.0 (29483883e 2025-08-04)

   $ .toolchain/msys64/mingw64/bin/gcc.exe --version
   gcc.exe (Rev4, Built by MSYS2 project) 16.2.0
   ```

诚实边界：第 1–3 步是这套工具链当初落地时的做法，本轮只复核了产物版本号，没有重跑下载和 pacman；第 4 步的 `cargo build`/`tauri build` 本轮没有执行（外壳由另一波次编译）。

## 目录结构与分层

| 路径 | 分层 | 职责 |
| --- | --- | --- |
| `src/core/earning.ts` | core（纯函数，零依赖） | 字符串 → BigInt 配置解析、`paidMsOf` 在岗时长、`earnedAtoms` 金额定点、`phaseOf` 阶段判定 |
| `src/core/format.ts` | core | atoms → 整数部分 + 12 位小数；`formatMicro` 供面板显示；绝不经过 Number |
| `src/core/settings.ts` | core | 面板输入模型 → 微单位映射与校验 |
| `src/ui/ticker.ts` | ui | requestAnimationFrame 循环外壳，`now/schedule/cancel` 可注入以便单测 |
| `src/ui/FloatingBar.tsx` | ui | 400×120 深色半透明悬浮条，每帧只写 textContent |
| `src/ui/SettingsPanel.tsx` | ui | 设置面板：受控输入 + 就地错误行 |
| `src/settings/storage.ts` | infra | `StorageAdapter` 接口 + localStorage 实现（key `workenergy.settings.v1`） |
| `src/App.tsx` | 演示页 | 加班开关、演示时钟、悬浮条与面板的组合 |
| `src-tauri/` | 外壳 | Tauri 2 窗口与 bundle 配置、Rust 入口 |

分层约定：core 不 import UI、不 import 浏览器 API，也不出现浮点；ui 只调 core 的纯函数；infra 只依赖 `StorageAdapter` 接口。

## 精度：为什么不会漂移

公式（`src/core/earning.ts` 的 `earnedAtoms`，一次性整数除法，无中间浮点）：

```text
earnedAtoms = salaryMicro × paidMs × 5 × 10^18 / (payDaysMicro × hoursMicro × 18)
```

- 1 atom = 10⁻¹⁸ 元。`salaryMicro` = 月薪(元) × 10⁶；`payDaysMicro` = 21.75 → `21750000n`；`hoursMicro` = 8 → `8000000n`。
- 常数 `5/18` 是把"每小时 3 600 000 毫秒"和 10¹⁸ atoms/元 一起约分的结果（10/36 = 5/18），所以整条式子里只有一次整除。
- **累加的是整数毫秒 `paidMs`，不是每帧金额**：先累加时间、再算钱，于是"3 600 次各 +1 秒"与"一次算 3 600 秒"逐位相等。
- 反例在单测里：`shows why atoms are derived from integer paidMs` —— 若逐帧累加金额，整数截断会一路累积偏差。
- 精度向量：月薪 10 000、21.75 天、8 小时 → 每小时 `10000 × 10^18 / 174` atoms，显示为 `57.471264367816` 元。
- 显示是**截断**到 12 位而非四舍五入（atoms 有 18 位精度，显示丢掉后 6 位）。

## 渲染纪律

rAF 回调里只做三件事：读 `Date.now()`、算一次纯函数、写三个 DOM 文本节点。React 只在挂载与设置变更时渲染，整条 bar 的跳动完全不经过协调层；数字用 `tabular-nums` 防止字宽抖动；`body` 保持 `transparent`，为透明无边框桌面窗留位。

## CI 与发布

`.github/workflows/release.yml`（GitHub Actions，Windows x64）：

- 触发：push 到 `main`、推 `v*` tag、PR 到 `main`、以及手动作业。
- `build` job（`runs-on: windows-latest`，`strategy.matrix` 单条目）：checkout → `pnpm/action-setup@v4` + `actions/setup-node@v4`（pnpm 缓存）→ `pnpm install --frozen-lockfile` → `pnpm exec vitest run` → `pnpm build` → `dtolnay/rust-toolchain@stable`（**MSVC**，CI 不照搬本机 gnu 路线）→ `Swatinem/rust-cache@v2` → `pnpm add -D @tauri-apps/cli@^2` → `pnpm exec tauri build` → `actions/upload-artifact@v4` 上传 `src-tauri/target/release/*.exe` 与 `src-tauri/target/release/bundle/nsis/*.exe`。
- `release` job 只在 tag 时运行（`needs: build`）：下载 artifact，用 `softprops/action-gh-release@v2` 建 Release 并挂上 exe 与安装包。
- 权限：工作流默认 `contents: read`，只有 `release` job 提升到 `contents: write`。
- **arm64 暂不构建**：矩阵只留 x64 一条。要加 `aarch64-pc-windows-msvc` 时，除了追加矩阵条目，产物路径也要从 `src-tauri/target/release` 改成 `src-tauri/target/<triple>/release`（因为需要显式传 `--target`）。
- 顺序上的一个坑：`tauri.conf.json` 没有配置 `beforeBuildCommand`，所以 workflow 必须先 `pnpm build` 产出 `dist/`，`tauri build` 只负责打包，不会替你构建前端。

## 已知限制

- **v1 不支持跨夜班**：下班时间 ≤ 上班时间直接判定为配置错误（`isMisconfigured`），金额恒为 0，阶段显示"配置错误"。
- 在岗时长按"当天本地时间"计算；跨天只做下班冻结，不做历史累计（不记昨天赚了多少）。
- **托盘图标、开机自启、无边框透明窗的完整行为**待外壳波次补齐；当前版本不含这部分能力。
- **存储仍是 localStorage 适配器**（`workenergy.settings.v1`）。外壳波次会换成 Tauri store / 等价的键值后端，届时只替换 `src/settings/storage.ts` 里 `StorageAdapter` 的实现，`core/settings.ts` 与面板组件不用改。
- 本机没有 MSVC，本地 `tauri build` 只能走 gnu 路线；正式发布包以 CI 的 MSVC 产物为准，两者 ABI 不完全等价。
- 金额显示截断而非四舍五入（见"精度"一节）。

## 许可

MIT，见 [LICENSE](LICENSE)。Copyright (c) 2026 WorkEnergy contributors。
