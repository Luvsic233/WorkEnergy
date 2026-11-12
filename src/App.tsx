import { useEffect, useMemo, useState } from "react";
import { parseSettings } from "./core/earning";
import { DEFAULT_INPUT, validateInput, type RawInput } from "./core/settings";
import { localStorageAdapter } from "./settings/storage";
import { FloatingBar } from "./ui/FloatingBar";
import { SettingsPanel } from "./ui/SettingsPanel";

const BASE_SETTINGS = parseSettings({ salary: "10000" });

export function App() {
  const [overtimeMode, setOvertimeMode] = useState(false);
  const [demoClock, setDemoClock] = useState(true);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedInput, setSavedInput] = useState<RawInput>(DEFAULT_INPUT);

  useEffect(() => {
    let alive = true;
    localStorageAdapter
      .load()
      .then((stored) => {
        if (!alive || !stored) return;
        setSavedInput(stored);
        setOvertimeMode(stored.overtimeMode);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const panelInitial = useMemo(() => ({ ...savedInput, overtimeMode }), [savedInput, overtimeMode]);

  const settings = useMemo(
    () => ({ ...(validateInput(savedInput).settings ?? BASE_SETTINGS), overtimeMode }),
    [savedInput, overtimeMode],
  );

  const now = useMemo(() => {
    if (!demoClock) return Date.now;
    const anchor = new Date();
    anchor.setHours(9, 30, 0, 0);
    const virtualStart = anchor.getTime();
    const realStart = Date.now();
    return () => virtualStart + (Date.now() - realStart) * 60;
  }, [demoClock]);

  return (
    <main className="stage">
      <FloatingBar
        settings={settings}
        decimals={savedInput.decimals}
        refreshHz={savedInput.refreshHz}
        displayMode={savedInput.displayMode}
        now={now}
      />
      <div className="controls">
        <label>
          <input type="checkbox" checked={overtimeMode} onChange={(event) => setOvertimeMode(event.currentTarget.checked)} />
          加班模式（18:00 后继续累计）
        </label>
        <label>
          <input type="checkbox" checked={demoClock} onChange={(event) => setDemoClock(event.currentTarget.checked)} />
          演示时钟（09:30 起，60×）
        </label>
        <button type="button" className="settings-open" onClick={() => setSettingsOpen(true)}>
          打开设置
        </button>
      </div>

      <SettingsPanel
        open={settingsOpen}
        initial={panelInitial}
        adapter={localStorageAdapter}
        onClose={() => setSettingsOpen(false)}
        onSaved={(value) => {
          setSavedInput(value);
          setOvertimeMode(value.overtimeMode);
        }}
      />
    </main>
  );
}
