import { useMemo, useState } from "react";
import { parseSettings } from "./core/earning";
import { FloatingBar } from "./ui/FloatingBar";

const BASE_SETTINGS = parseSettings({ salary: "10000" });

export function App() {
  const [overtimeMode, setOvertimeMode] = useState(false);
  const [demoClock, setDemoClock] = useState(true);

  const settings = useMemo(() => ({ ...BASE_SETTINGS, overtimeMode }), [overtimeMode]);

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
      <FloatingBar settings={settings} now={now} />
      <div className="controls">
        <label>
          <input type="checkbox" checked={overtimeMode} onChange={(event) => setOvertimeMode(event.currentTarget.checked)} />
          加班模式（18:00 后继续累计）
        </label>
        <label>
          <input type="checkbox" checked={demoClock} onChange={(event) => setDemoClock(event.currentTarget.checked)} />
          演示时钟（09:30 起，60×）
        </label>
      </div>
    </main>
  );
}
