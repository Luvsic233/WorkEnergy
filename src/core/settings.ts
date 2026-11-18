import {
  MULTIPLIER_MAX_MICRO,
  MULTIPLIER_MIN_MICRO,
  OVERTIME_PAY_MODES,
  normalAtoms,
  parseClock,
  parseMicro,
  type OvertimePayMode,
  type Settings,
} from "./earning";
import { DEFAULT_DECIMALS, type Decimals } from "./format";

/** 小数位数可选档位（18 = 机芯原生上限），面板按此顺序渲染，白名单与之一致。 */
export const DECIMALS_OPTIONS: readonly Decimals[] = [18, 12, 6];

/** 文本跳变频率档位：60 = 每帧、10 = 每 100ms、1 = 每 1000ms。roll 模式下它就是小数滚动的节拍。 */
export type RefreshHz = 60 | 10 | 1;

/** 跳动频率可选档位，面板按此顺序渲染。 */
export const REFRESH_HZ_OPTIONS: readonly RefreshHz[] = [60, 10, 1];

/** 窗口尺寸档位：无边框悬浮条整体缩小 / 放大，窗口逻辑尺寸与内容缩放系数成对变化。 */
export type SizePreset = "compact" | "standard" | "wide";

/** 一档窗口尺寸：逻辑像素窗口大小 + 内容缩放系数（字号与间距统一乘这个系数）。 */
export interface SizePresetSpec {
  /** 窗口逻辑宽度（px）。 */
  width: number;
  /** 窗口逻辑高度（px）。 */
  height: number;
  /** 内容缩放系数：1 = 宽松档（400x120 的原始排版）。 */
  scale: number;
  /** 面板上的档位名。 */
  label: string;
}

/** 三档定义（唯一事实来源）：窗口尺寸与缩放系数在这里成对给出，CSS 只消费 --bar-scale。 */
export const SIZE_PRESETS: Readonly<Record<SizePreset, SizePresetSpec>> = {
  compact: { width: 300, height: 80, scale: 0.75, label: "紧凑" },
  standard: { width: 360, height: 96, scale: 0.9, label: "标准" },
  wide: { width: 400, height: 120, scale: 1, label: "宽松" },
};

/** 窗口尺寸可选档位，面板按此顺序渲染，白名单与之一致；第一档就是默认档。 */
export const SIZE_PRESET_OPTIONS: readonly SizePreset[] = ["compact", "standard", "wide"];

export const DEFAULT_SIZE_PRESET: SizePreset = "compact";

/** 档位 → 尺寸 / 缩放系数；未登记的档位（手改存储、老版本）回落默认档而不是抛错。 */
export function sizePresetSpec(preset: SizePreset): SizePresetSpec {
  return SIZE_PRESETS[preset] ?? SIZE_PRESETS[DEFAULT_SIZE_PRESET];
}

/**
 * 金额区的显示方式：
 * - roll：整数位常态精确停在该位的整格上，只有这一位数值变化时才用 260ms 快速滚过一格
 *   （绝不长时间停在两格之间）；小数每 1000/refreshHz 毫秒才检测一次变化、向上滚 d 格，
 *   滚动时长随档位自适应（见 RollingDigit 的 fracCapMs）。
 * - jump：没有任何动画，整数与小数一起按 refreshHz 整片跳变（旧行为）。
 */
export type DisplayMode = "roll" | "jump";

/** 显示方式可选档位，面板按此顺序渲染，白名单与之一致。 */
export const DISPLAY_MODE_OPTIONS: readonly DisplayMode[] = ["roll", "jump"];

/** 一种加班计薪方式在面板上的全部文案与它绑定的输入字段（唯一事实来源，面板与校验都读它）。 */
export interface OvertimePaySpec {
  /** 该模式绑定的 RawInput 字段：每种模式各自记住自己的数值，切来切去不会把 1.5 带到「元每小时」。 */
  field: "overtimeMultiplier" | "overtimeFixedHourly" | "overtimeFixedTotal";
  /** 分段按钮上的名字。 */
  label: string;
  /** 数值输入框的标签，随模式变化。 */
  valueLabel: string;
  /** 就地说明：这一档到底怎么算钱。 */
  hint: string;
}

export const OVERTIME_PAY_SPECS: Readonly<Record<OvertimePayMode, OvertimePaySpec>> = {
  multiplier: {
    field: "overtimeMultiplier",
    label: "倍数",
    valueLabel: "倍数",
    hint: "加班时薪 = 正常时薪 × 倍数（1.0–5.0，步长 0.1）；1.0 等于完全不加成。",
  },
  fixedHourly: {
    field: "overtimeFixedHourly",
    label: "固定时薪",
    valueLabel: "元每小时",
    hint: "加班时段每小时固定这么多钱，与月薪无关；正常工作时段仍按上面的月薪换算。",
  },
  fixedTotal: {
    field: "overtimeFixedTotal",
    label: "固定总额",
    valueLabel: "元每次",
    hint: "下班那一刻一次性到账这个金额（与加班多久无关），之后的加班时段仍按正常时薪继续累计。",
  },
};

/** 倍数档的步长（0.1）与上下限（1.0 / 5.0）以微单位表述，校验与引擎共用。 */
export const OVERTIME_MULTIPLIER_STEP_MICRO = 100_000n;

/** 当前模式生效的那个数值输入框（面板只渲染这一个）。 */
export function activeOvertimeField(mode: OvertimePayMode): OvertimePaySpec["field"] {
  return OVERTIME_PAY_SPECS[mode].field;
}

/** 用户在设置面板里能看到的全部输入，金额一律是字符串 / 布尔，没有任何 Number 参与金额。 */
export interface RawInput {
  salary: string;
  payDays: string;
  hours: string;
  workStart: string;
  workEnd: string;
  lunchEnabled: boolean;
  lunchStart: string;
  lunchEnd: string;
  overtimeMode: boolean;
  /** 加班计薪方式（三选一），默认倍数制。 */
  overtimePayMode: OvertimePayMode;
  /** 倍数制下的倍数（文本，1.0–5.0）。 */
  overtimeMultiplier: string;
  /** 固定时薪制下的元 / 小时（文本）。 */
  overtimeFixedHourly: string;
  /** 固定总额制下的元 / 次（文本，下班那一刻一次性到账）。 */
  overtimeFixedTotal: string;
  /** 小数位数：18 位（默认，机芯上限）/ 12 位 / 6 位。 */
  decimals: Decimals;
  /** 文本跳变频率档位，默认 10Hz；roll 模式管小数滚动的节拍与时长，jump 模式管整串数字。 */
  refreshHz: RefreshHz;
  /** 金额区显示方式，默认 roll（整数精确落位 + 变化时快速滚一格，小数按 refreshHz 跳）。 */
  displayMode: DisplayMode;
  /** 窗口尺寸档位，默认 compact（300x80 / 0.75 倍内容缩放）。 */
  sizePreset: SizePreset;
}

export const DEFAULT_INPUT: RawInput = {
  salary: "10000",
  payDays: "21.75",
  hours: "8",
  workStart: "09:00",
  workEnd: "18:00",
  lunchEnabled: true,
  lunchStart: "12:00",
  lunchEnd: "13:00",
  overtimeMode: false,
  overtimePayMode: "multiplier",
  overtimeMultiplier: "1.5",
  overtimeFixedHourly: "60",
  overtimeFixedTotal: "200",
  decimals: DEFAULT_DECIMALS,
  refreshHz: 10,
  displayMode: "roll",
  sizePreset: DEFAULT_SIZE_PRESET,
};

/** 校验会报错的字段（开关本身不会报错）。 */
export type InputField =
  | "salary"
  | "payDays"
  | "hours"
  | "workStart"
  | "workEnd"
  | "lunchStart"
  | "lunchEnd"
  | "overtimePayMode"
  | "overtimeMultiplier"
  | "overtimeFixedHourly"
  | "overtimeFixedTotal"
  | "decimals"
  | "refreshHz"
  | "displayMode"
  | "sizePreset";

export type FieldErrors = Partial<Record<InputField, string>>;

export interface ValidationResult {
  errors: FieldErrors;
  /** 只有在校验全绿时才有值；有错误时为 null，调用方不写存储。 */
  settings: Settings | null;
}

export const ONE_HOUR_MS = 3_600_000;

const DECIMAL = /^\d{1,12}(?:\.\d{1,6})?$/;
const CLOCK = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;

function decimalError(label: string, raw: string, mustBePositive: boolean): string | null {
  const text = raw.trim();
  if (text === "") return `${label}不能为空`;
  if (!DECIMAL.test(text)) return `${label}必须是数字（最多 12 位整数、6 位小数）`;
  if (mustBePositive && parseMicro(text) <= 0n) return `${label}必须大于 0`;
  return null;
}

function clockError(label: string, raw: string): string | null {
  const text = raw.trim();
  if (text === "") return `${label}不能为空`;
  if (!CLOCK.test(text)) return `${label}格式应为 HH:MM（00:00–23:59）`;
  return null;
}

/** 枚举型字段（小数位数 / 跳动频率 / 显示方式）只接受面板给出的档位。 */
function choiceError<T extends number | string>(label: string, allowed: readonly T[], value: T): string | null {
  return (allowed as readonly (number | string)[]).includes(value) ? null : `${label}只能是 ${allowed.join(" / ")}`;
}

/**
 * 用户输入（字符串）→ 契约 Settings（BigInt 微单位）。
 * 金额字段一律走 parseMicro，全程整数，绝不 parseFloat；显示档位不进 Settings（薪资契约冻结）。
 */
export function toSettings(input: RawInput): Settings {
  return {
    salaryMicro: parseMicro(input.salary),
    payDaysMicro: parseMicro(input.payDays),
    hoursMicro: parseMicro(input.hours),
    workStartMin: parseClock(input.workStart),
    workEndMin: parseClock(input.workEnd),
    lunchStartMin: input.lunchEnabled ? parseClock(input.lunchStart) : null,
    lunchEndMin: input.lunchEnabled ? parseClock(input.lunchEnd) : null,
    overtimeMode: input.overtimeMode,
    // 只把当前模式那个数值收进契约：另外两档的文本原样留在 RawInput 里，切回去时还是上次的数。
    overtime: {
      mode: input.overtimePayMode,
      valueMicro: parseMicro(input[activeOvertimeField(input.overtimePayMode)]),
    },
  };
}

/** 倍数：1.0–5.0、步长 0.1，且必须是正整数微单位。 */
function multiplierError(raw: string): string | null {
  const base = decimalError("倍数", raw, true);
  if (base) return base;
  const micro = parseMicro(raw.trim());
  if (micro < MULTIPLIER_MIN_MICRO || micro > MULTIPLIER_MAX_MICRO) return "倍数必须在 1.0–5.0 之间";
  if (micro % OVERTIME_MULTIPLIER_STEP_MICRO !== 0n) return "倍数步长为 0.1（例如 1.5）";
  return null;
}

/** 固定时薪 / 固定总额：只要求大于 0。 */
function positiveYuanError(label: string, raw: string): string | null {
  const base = decimalError(label, raw, true);
  if (base) return base;
  return parseMicro(raw.trim()) > 0n ? null : `${label}必须大于 0`;
}

export function validateInput(input: RawInput): ValidationResult {
  const errors: FieldErrors = {};

  const salary = decimalError("月薪", input.salary, true);
  if (salary) errors.salary = salary;

  const payDays = decimalError("计薪天数", input.payDays, true);
  if (payDays) errors.payDays = payDays;

  const hours = decimalError("日工时", input.hours, true);
  if (hours) errors.hours = hours;

  const decimals = choiceError("小数位数", DECIMALS_OPTIONS, input.decimals);
  if (decimals) errors.decimals = decimals;

  const refreshHz = choiceError("跳动频率", REFRESH_HZ_OPTIONS, input.refreshHz);
  if (refreshHz) errors.refreshHz = refreshHz;

  const displayMode = choiceError("显示方式", DISPLAY_MODE_OPTIONS, input.displayMode);
  if (displayMode) errors.displayMode = displayMode;

  const sizePreset = choiceError("窗口尺寸", SIZE_PRESET_OPTIONS, input.sizePreset);
  if (sizePreset) errors.sizePreset = sizePreset;

  // 加班计薪：模式必须是三选一；数值只校验当前生效的那一档（另外两档此刻不可见，报错会无处安放）。
  const overtimePayMode = choiceError("加班计薪", OVERTIME_PAY_MODES, input.overtimePayMode);
  if (overtimePayMode) {
    errors.overtimePayMode = overtimePayMode;
  } else {
    const spec = OVERTIME_PAY_SPECS[input.overtimePayMode];
    const valueError =
      input.overtimePayMode === "multiplier"
        ? multiplierError(input.overtimeMultiplier)
        : positiveYuanError(spec.valueLabel, input[spec.field]);
    if (valueError) errors[spec.field] = valueError;
  }

  const startError = clockError("上班时间", input.workStart);
  if (startError) errors.workStart = startError;

  const endError = clockError("下班时间", input.workEnd);
  if (endError) errors.workEnd = endError;

  if (!startError && !endError && parseClock(input.workEnd) <= parseClock(input.workStart)) {
    errors.workEnd = "下班时间必须晚于上班时间（本版不支持跨夜班）";
  }

  if (input.lunchEnabled) {
    const lunchStartError = clockError("午休开始", input.lunchStart);
    if (lunchStartError) errors.lunchStart = lunchStartError;

    const lunchEndError = clockError("午休结束", input.lunchEnd);
    if (lunchEndError) errors.lunchEnd = lunchEndError;

    if (!lunchStartError && !lunchEndError && parseClock(input.lunchEnd) <= parseClock(input.lunchStart)) {
      errors.lunchEnd = "午休结束必须晚于午休开始";
    }
  }

  if (Object.keys(errors).length > 0) return { errors, settings: null };
  return { errors, settings: toSettings(input) };
}

/** 时薪（atoms，1e-18 元）：正常时段的定点公式，1 小时 = 3_600_000 ms（不含任何加班加成）。 */
export function hourlyAtoms(settings: Settings): bigint {
  return normalAtoms(settings, ONE_HOUR_MS);
}
