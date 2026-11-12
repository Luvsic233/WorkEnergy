import { useEffect, useMemo, useState } from "react";
import { formatAtoms } from "../core/format";
import {
  DECIMALS_OPTIONS,
  DEFAULT_INPUT,
  DISPLAY_MODE_OPTIONS,
  hourlyAtoms,
  REFRESH_HZ_OPTIONS,
  sizePresetSpec,
  SIZE_PRESET_OPTIONS,
  validateInput,
  type RawInput,
} from "../core/settings";
import type { StorageAdapter } from "../settings/storage";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "../theme/builtin";
import type { Theme } from "../theme/types";
import "../settings/panel.css";

interface SettingsPanelProps {
  open: boolean;
  initial: RawInput;
  adapter: StorageAdapter;
  onClose(): void;
  onSaved(value: RawInput): void;
  /**
   * 可选的主题服务：不传时只列内置主题（面板要能在没有主题服务的场合单独渲染，例如 SSR 单测）。
   * 传了就是完整清单（内置 + 用户目录），切换回调把选择交给调用方去持久化并立即生效。
   */
  themes?: readonly Theme[];
  themeId?: string;
  onSelectTheme?(id: string): void;
  onOpenThemeFolder?(): void;
}

const NOOP = () => undefined;

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

interface ChoiceProps<T extends number | string> {
  label: string;
  options: readonly T[];
  value: T;
  error?: string;
  hint?: string;
  /** 当前显示方式下这一组档位不起作用时置灰：值仍然显示，但点不动。 */
  disabled?: boolean;
  format(option: T): string;
  onChange(value: T): void;
}

/** 档位开关：显示方式 roll/jump、小数位数 18/12/6、跳动频率 60/10/1Hz、窗口尺寸三档，只写草稿，点保存才落盘。 */
function Choice<T extends number | string>({
  label,
  options,
  value,
  error,
  hint,
  disabled = false,
  format,
  onChange,
}: ChoiceProps<T>) {
  return (
    <div className={disabled ? "settings-choice is-disabled" : "settings-choice"}>
      <span className="settings-field-label">{label}</span>
      <div
        className="settings-segmented"
        role="group"
        aria-label={label}
        // 只有在真的禁用时才输出 aria-disabled：false 也会渲染成字符串，读起来像"被禁了"。
        aria-disabled={disabled ? "true" : undefined}
      >
        {options.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              aria-disabled={disabled ? "true" : undefined}
              disabled={disabled}
              className={active ? "settings-segment is-active" : "settings-segment"}
              onClick={() => onChange(option)}
            >
              {format(option)}
            </button>
          );
        })}
      </div>
      {error ? <span className="settings-error">{error}</span> : null}
      {hint ? <span className="settings-hint">{hint}</span> : null}
    </div>
  );
}

export function SettingsPanel({
  open,
  initial,
  adapter,
  onClose,
  onSaved,
  themes = BUILTIN_THEMES,
  themeId = DEFAULT_THEME_ID,
  onSelectTheme = NOOP,
  onOpenThemeFolder = NOOP,
}: SettingsPanelProps) {
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
          label="显示方式"
          options={DISPLAY_MODE_OPTIONS}
          value={draft.displayMode}
          error={errors.displayMode}
          format={(option) => (option === "roll" ? "机械滚动" : "整串跳动")}
          onChange={(value) => update("displayMode", value)}
        />
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
          // roll：小数是连续滚动，没有"多久跳一次"这回事，这一组档位对它不起作用，置灰并把话说清楚。
          disabled={draft.displayMode === "roll"}
          hint={
            draft.displayMode === "roll"
              ? "滚动模式下小数连续滚动，频率档位只影响跳跃模式"
              : "整串数字按此频率整片跳变，没有任何动画"
          }
          format={(option) => `${option} Hz`}
          onChange={(value) => update("refreshHz", value)}
        />
        <Choice
          label="窗口尺寸"
          options={SIZE_PRESET_OPTIONS}
          value={draft.sizePreset}
          error={errors.sizePreset}
          hint={`${sizePresetSpec(draft.sizePreset).width} × ${sizePresetSpec(draft.sizePreset).height} 逻辑像素（内容 ${sizePresetSpec(draft.sizePreset).scale} 倍），保存后立即生效，无需重启`}
          format={(option) => sizePresetSpec(option).label}
          onChange={(value) => update("sizePreset", value)}
        />
      </div>

      <div className="settings-themes">
        <div className="settings-choice">
          <span className="settings-field-label">外观主题</span>
          <div className="settings-theme-list" role="radiogroup" aria-label="外观主题">
            {themes.map((theme) => {
              const active = theme.id === themeId;
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={active ? "settings-theme is-active" : "settings-theme"}
                  onClick={() => onSelectTheme(theme.id)}
                >
                  <span
                    className="settings-theme-swatch"
                    style={{ background: theme.colors.bar, borderColor: theme.colors.border }}
                  />
                  <span className="settings-theme-name">{theme.name}</span>
                  <span className="settings-theme-source">{theme.source === "builtin" ? "内置" : "用户目录"}</span>
                </button>
              );
            })}
          </div>
          <span className="settings-hint">切换立即生效，无需重启；配色与字体在浏览器预览里同样能看到效果。</span>
          <button type="button" className="settings-btn settings-theme-open" onClick={onOpenThemeFolder}>
            打开主题文件夹
          </button>
        </div>
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
