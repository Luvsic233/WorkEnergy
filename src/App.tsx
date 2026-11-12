import { useEffect, useMemo, useState } from "react";
import { parseSettings } from "./core/earning";
import { DEFAULT_INPUT, validateInput, type RawInput } from "./core/settings";
import { applySizePreset, applyStartupSizePreset, emit, invoke, listen } from "./settings/bridge";
import { localStorageAdapter, readStoredSizePreset } from "./settings/storage";
import { FloatingBar } from "./ui/FloatingBar";
import { SettingsPanel } from "./ui/SettingsPanel";

const BASE_SETTINGS = parseSettings({ salary: "10000" });

/** 独立设置窗口的路由（同一份 bundle，按 hash 分流）。 */
const SETTINGS_ROUTE = "#/settings";

function inSettingsWindow(): boolean {
  return window.location.hash.startsWith(SETTINGS_ROUTE);
}

/*
 * 首帧无跳变的做法：在 React 挂载之前（模块求值阶段）就把档位落到 CSS 变量上，并且
 * 先藏住内容、等窗口尺寸真正落地（或 150ms 兜底）再显示。
 * 于是"第一眼"看到的就是目标档的窗口尺寸与目标档的排版，不会先按 tauri.conf.json 的
 * 400x120 画一遍再突然收缩。设置窗口（430x540 带系统标题栏）不参与缩窗。
 */
if (!inSettingsWindow()) applyStartupSizePreset(readStoredSizePreset());

/** 读已保存的输入，并在设置窗口保存后（跨窗口事件）重新读一次。 */
function useSavedInput(): RawInput {
  const [savedInput, setSavedInput] = useState<RawInput>(DEFAULT_INPUT);

  useEffect(() => {
    let alive = true;
    const load = () => {
      localStorageAdapter
        .load()
        .then((stored) => {
          if (alive && stored) setSavedInput(stored);
        })
        .catch(() => undefined);
    };
    load();
    let stop: (() => void) | null = null;
    void listen("settings-changed", load).then((off) => {
      stop = off;
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  return savedInput;
}

/** 悬浮条窗口：400x120 里只有数字与阶段文字。 */
function FloatingWindow() {
  const savedInput = useSavedInput();
  const settings = useMemo(
    () => ({ ...(validateInput(savedInput).settings ?? BASE_SETTINGS), overtimeMode: savedInput.overtimeMode }),
    [savedInput],
  );

  // 设置窗口保存后跨窗口事件会重读档位：CSS 立即缩放、窗口尺寸跟着改，不需要重启。
  const sizePreset = savedInput.sizePreset;
  useEffect(() => {
    applySizePreset(sizePreset);
  }, [sizePreset]);

  return (
    <main className="stage">
      <FloatingBar
        settings={settings}
        decimals={savedInput.decimals}
        refreshHz={savedInput.refreshHz}
        displayMode={savedInput.displayMode}
      />
    </main>
  );
}

/** 独立设置窗口：带系统标题栏，关闭时隐藏（再次「设置…」直接复用）。 */
function SettingsWindow() {
  const [initial, setInitial] = useState<RawInput | null>(null);

  useEffect(() => {
    let alive = true;
    localStorageAdapter
      .load()
      .then((stored) => {
        if (alive) setInitial(stored ?? DEFAULT_INPUT);
      })
      .catch(() => {
        if (alive) setInitial(DEFAULT_INPUT);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="settings-window">
      {initial ? (
        <SettingsPanel
          open
          initial={initial}
          adapter={localStorageAdapter}
          onClose={() => {
            void invoke("hide_settings");
          }}
          onSaved={() => {
            void emit("settings-changed");
          }}
        />
      ) : null}
    </main>
  );
}

export function App() {
  return inSettingsWindow() ? <SettingsWindow /> : <FloatingWindow />;
}
