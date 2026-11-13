# WorkEnergy · 上班实时工资

常驻桌面的小挂件：实时显示今天上班已经赚到多少钱。小数逐帧滚动，还配了一只会在下班、加班时变脸的猫。

## 功能

- **实时金额**：小数位数 6 / 12 / 18 可选，逐帧滚动累加
- **薪资折算**：默认月薪 ÷ 21.75 天 ÷ 8 小时，系数都能改；午休时段可扣除
- **三种状态**：在岗 / 已下班（金额冻结）/ 加班（下班后继续累计）
- **耄耋猫主题**：三种状态三张图；金额每满 20 元从卡片上方随机弹一只动图猫，4 秒收起
- **左键点一下**：卡片像果冻弹一下 + 冒一句吐槽；累计点击有里程碑彩蛋
- **桌面集成**：托盘、开机自启、窗口位置记忆、默认不置顶（右键可切换）

## 下载

到 [Releases](https://github.com/Luvsic233/WorkEnergy/releases/latest) 下载 `WorkEnergy_x.y.z_x64-setup.exe`，装完即用，**不需要装任何运行环境**。

- 左键按住拖动位置，右键出菜单（设置 / 总在最前 / 开机自启 / 隐藏）
- 卸载时勾选 **Delete the application data**，配置和计数会一起清掉

## 换成自己的图（可选）

图片已内置，开箱即用。想换的话，把同名文件放进：

```
%APPDATA%\com.workenergy.shell\themes\maodie\
```

| 文件名 | 用在哪 |
| --- | --- |
| `kitty-idle` | 在岗 |
| `kitty-offwork` | 已下班 |
| `kitty-overtime` | 加班 |
| `celebrate-1` / `celebrate-2` | 满 20 元的庆祝动图（随机播一张） |

扩展名支持 png / webp / gif。**这个目录里的图优先于内置图**，删掉即恢复默认。

## 开发

需要 Node ≥ 20。

```bash
pnpm install --store-dir .pnpm-store
pnpm dev          # http://localhost:5173
pnpm test         # vitest，288 个用例
pnpm typecheck
pnpm tauri:build  # 打 exe + NSIS 安装包
```

## 实现要点

- 金额用 **BigInt 定点**（1 atom = 10⁻¹⁸ 元）：先累加整数毫秒、再做一次整除算钱，不做浮点累加，所以长时间运行不漂移
- 每帧只写几个 DOM 文本节点，跳动完全不经过 React 渲染
- 猫主题的卡片宽度按内容实测后调整窗口大小；点击的果冻形变是体积守恒的 squash & stretch

## 已知限制

- 不支持跨夜班（下班时间 ≤ 上班时间会判定为配置错误）
- 只算当天，不记昨天赚了多少
- 发布用 CI 的 MSVC 产物；本机因无管理员权限只能走 gnu 工具链，仅供本地调试

## 许可

MIT，见 [LICENSE](LICENSE)。
