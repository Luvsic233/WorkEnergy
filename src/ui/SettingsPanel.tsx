import { useEffect, useMemo, useState } from "react";
import { formatAtoms } from "../core/format";
import {
  DECIMALS_OPTIONS,
  DEFAULT_INPUT,
  hourlyAtoms,
  REFRESH_HZ_OPTIONS,
  validateInput,
  type RawInput,
} from "../core/settings";
import type { StorageAdapter } from "../settings/storage";
import "../settings/panel.css";

interface SettingsPanelProps {
  open: boolean;
  initial: RawInput;
  adapter: StorageAdapter;
  onClose(): void;
  onSaved(value: RawInput): void;
}

interface FieldProps {
  label: string;
  value: string;
  error?: string;
  onChange(value: string): void;
}

function Field({ label, value, error, onChange }: FieldProps) {
  return (
    <label className="settings-field">
      <span className="settings-field-label">{label}</span>
      <input
        className={error ? "settings-input is-invalid" : "settings-input"}
        type="text"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error ? <span className="settings-error">{error}</span> : null}
    </label>
  );
}

interface ChoiceProps<T extends number> {
  label: string;
  options: readonly T[];
  value: T;
  error?: string;
  format(option: T): string;
  onChange(value: T): void;
}

/** 档位开关：小数位数 12/6/3、跳动频率 60/10/1Hz，只写草稿，点保存才落盘。 */
function Choice<T extends number>({ label, options, value, error, format, onChange }: ChoiceProps<T>) {
  return (
    <div className="settings-choice">
      <span className="settings-field-label">{label}</span>
      <div className="settings-segmented" role="group" aria-label={label}>
        {options.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              className={active ? "settings-segment is-active" : "settings-segment"}
              onClick={() => onChange(option)}
            >
              {format(option)}
            </button>
          );
        })}
      </div>
      {error ? <span className="settings-error">{error}</span> : null}
    </div>
  );
}

export function SettingsPanel({ open, initial, adapter, onClose, onSaved }: SettingsPanelProps) {
  const [draft, setDraft] = useState<RawInput>(initial);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // 只在打开时把面板重设为已保存的输入；打开期间用户的输入不会被外部状态覆盖。
  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setStatus(null);
  }, [open]);

  const { errors, settings } = useMemo(() => validateInput(draft), [draft]);
  const hourly = settings ? formatAtoms(hourlyAtoms(settings)) : null;

  if (!open) return null;

  function update<K extends keyof RawInput>(key: K, value: RawInput[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setStatus(null);
  }

  async function save() {
    if (!settings) {
      setStatus("有字段未通过校验，未写入存储");
      return;
    }
    setSaving(true);
    try {
      await adapter.save(draft);
      onSaved(draft);
      setStatus("已保存，悬浮条已更新");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-panel" aria-label="薪资设置">
      <header className="settings-head">
        <h2 className="settings-title">薪资设置</h2>
        <button type="button" className="settings-close" onClick={onClose} aria-label="关闭设置">
          ×
        </button>
      </header>

      <Field label="月薪（元）" value={draft.salary} error={errors.salary} onChange={(value) => update("salary", value)} />

      <div className="settings-hourly">
        <span className="settings-hourly-label">据此换算的时薪</span>
        <span className="settings-hourly-value">
          {hourly ? `${hourly.int}.${hourly.frac}` : "—"} <span className="settings-hourly-unit">元 / 小时</span>
        </span>
      </div>

      <div className="settings-display">
        <Choice
          label="小数位数"
          options={DECIMALS_OPTIONS}
          value={draft.decimals}
          error={errors.decimals}
          format={(option) => `${option} 位`}
          onChange={(value) => update("decimals", value)}
        />
        <Choice
          label="跳动频率"
          options={REFRESH_HZ_OPTIONS}
          value={draft.refreshHz}
          error={errors.refreshHz}
          format={(option) => `${option} Hz`}
          onChange={(value) => update("refreshHz", value)}
        />
      </div>

      <button
        type="button"
        className="settings-toggle"
        aria-expanded={advanced}
        onClick={() => setAdvanced((previous) => !previous)}
      >
        {advanced ? "收起高级 ▴" : "展开高级 ▾"}
      </button>

      {advanced ? (
        <div className="settings-advanced">
          <Field
            label="计薪天数 / 月"
            value={draft.payDays}
            error={errors.payDays}
            onChange={(value) => update("payDays", value)}
          />
          <Field
            label="日工时（小时）"
            value={draft.hours}
            error={errors.hours}
            onChange={(value) => update("hours", value)}
          />
          <div className="settings-row">
            <Field
              label="上班"
              value={draft.workStart}
              error={errors.workStart}
              onChange={(value) => update("workStart", value)}
            />
            <Field
              label="下班"
              value={draft.workEnd}
              error={errors.workEnd}
              onChange={(value) => update("workEnd", value)}
            />
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={draft.lunchEnabled}
              onChange={(event) => update("lunchEnabled", event.currentTarget.checked)}
            />
            午休
          </label>
          {draft.lunchEnabled ? (
            <div className="settings-row">
              <Field
                label="午休开始"
                value={draft.lunchStart}
                error={errors.lunchStart}
                onChange={(value) => update("lunchStart", value)}
              />
              <Field
                label="午休结束"
                value={draft.lunchEnd}
                error={errors.lunchEnd}
                onChange={(value) => update("lunchEnd", value)}
              />
            </div>
          ) : null}
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={draft.overtimeMode}
              onChange={(event) => update("overtimeMode", event.currentTarget.checked)}
            />
            加班模式（下班后继续累计）
          </label>
        </div>
      ) : null}

      <footer className="settings-foot">
        <button
          type="button"
          className="settings-btn"
          onClick={() => {
            setDraft(DEFAULT_INPUT);
            setStatus(null);
          }}
        >
          恢复默认
        </button>
        <span className="settings-status">{status}</span>
        <button
          type="button"
          className="settings-btn primary"
          disabled={saving}
          onClick={() => {
            void save();
          }}
        >
          保存
        </button>
        <button type="button" className="settings-btn ghost" onClick={onClose}>
          取消
        </button>
      </footer>
    </section>
  );
}
