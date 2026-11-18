export const ATOMS_PER_YUAN = 10n ** 18n;

const MICRO = 1_000_000n;
const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000n;

/** 加班计薪方式三选一：倍数 / 固定时薪 / 固定总额。 */
export type OvertimePayMode = "multiplier" | "fixedHourly" | "fixedTotal";

/** 面板与存储共用这份白名单（顺序即面板顺序，第一项是默认）。 */
export const OVERTIME_PAY_MODES: readonly OvertimePayMode[] = ["multiplier", "fixedHourly", "fixedTotal"];

/**
 * 加班计薪配置：一个模式 + 一个数值。
 * 数值一律是微单位 BigInt（1e6 = 1），含义随模式变化：
 * - multiplier：倍数（1_500_000 = 1.5 倍）；
 * - fixedHourly：元 / 小时（60_000_000 = 60 元每小时）；
 * - fixedTotal：元 / 每次（200_000_000 = 下班那一刻一次到账 200 元）。
 */
export interface OvertimePay {
  mode: OvertimePayMode;
  valueMicro: bigint;
}

/** 倍数可调范围：1.0 ~ 5.0（面板步长 0.1）。 */
export const MULTIPLIER_MIN_MICRO = 1_000_000n;
export const MULTIPLIER_MAX_MICRO = 5_000_000n;

/** 默认：倍数 1.5。 */
export const DEFAULT_OVERTIME_PAY: OvertimePay = { mode: "multiplier", valueMicro: 1_500_000n };

export interface Settings {
  salaryMicro: bigint;
  payDaysMicro: bigint;
  hoursMicro: bigint;
  workStartMin: number;
  workEndMin: number;
  lunchStartMin: number | null;
  lunchEndMin: number | null;
  overtimeMode: boolean;
  /**
   * 加班怎么算钱。缺省 = 默认倍数 1.5。
   * 刻意是可选字段：Settings 是跨模块的薪资契约，老记录与既有测试的字面量没有它，
   * 一律按默认值解释，绝不让一个可选的新玩法把整条链路弄成必填。
   */
  overtime?: OvertimePay;
}

export interface SettingsInput {
  salary: string;
  payDays?: string;
  hours?: string;
  workStart?: string;
  workEnd?: string;
  lunchStart?: string | null;
  lunchEnd?: string | null;
  overtimeMode?: boolean;
  /** 加班计薪方式，缺省 multiplier。 */
  overtimePayMode?: OvertimePayMode;
  /** 加班数值（十进制字符串，单位随 mode），缺省 "1.5"。 */
  overtimeValue?: string;
}

export type Phase = "配置错误" | "未到上班时间" | "在岗" | "午休" | "已下班" | "加班";

export function parseMicro(input: string): bigint {
  const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(input.trim());
  if (!match) throw new Error(`invalid decimal string: ${input}`);
  return BigInt(match[1]) * MICRO + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
}

export function parseClock(input: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) throw new Error(`invalid clock string: ${input}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`invalid clock string: ${input}`);
  return hours * 60 + minutes;
}

export function parseSettings(input: SettingsInput): Settings {
  return {
    salaryMicro: parseMicro(input.salary),
    payDaysMicro: parseMicro(input.payDays ?? "21.75"),
    hoursMicro: parseMicro(input.hours ?? "8"),
    workStartMin: parseClock(input.workStart ?? "09:00"),
    workEndMin: parseClock(input.workEnd ?? "18:00"),
    lunchStartMin: input.lunchStart === null ? null : parseClock(input.lunchStart ?? "12:00"),
    lunchEndMin: input.lunchEnd === null ? null : parseClock(input.lunchEnd ?? "13:00"),
    overtimeMode: input.overtimeMode ?? false,
    overtime: {
      mode: input.overtimePayMode ?? DEFAULT_OVERTIME_PAY.mode,
      valueMicro: parseMicro(input.overtimeValue ?? "1.5"),
    },
  };
}

/**
 * 取实际生效的加班计薪配置：缺字段 / 模式不认识 / 数值非法（<= 0、倍数越界）一律回落默认倍数 1.5。
 * 引擎只读这一个入口，所以坏数据永远不会把它算成负数或除零。
 */
export function overtimePayOf(settings: Settings): OvertimePay {
  const pay = settings.overtime;
  if (!pay || !OVERTIME_PAY_MODES.includes(pay.mode)) return DEFAULT_OVERTIME_PAY;
  if (pay.valueMicro <= 0n) return DEFAULT_OVERTIME_PAY;
  if (pay.mode === "multiplier" && (pay.valueMicro < MULTIPLIER_MIN_MICRO || pay.valueMicro > MULTIPLIER_MAX_MICRO)) {
    return DEFAULT_OVERTIME_PAY;
  }
  return pay;
}

export function isMisconfigured(settings: Settings): boolean {
  return settings.workEndMin <= settings.workStartMin;
}

function msOfDay(nowMs: number): number {
  const date = new Date(nowMs);
  return ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000 + date.getMilliseconds();
}

function lunchWindowMs(settings: Settings): [number, number] | null {
  const { lunchStartMin, lunchEndMin } = settings;
  if (lunchStartMin === null || lunchEndMin === null || lunchEndMin <= lunchStartMin) return null;
  return [lunchStartMin * MS_PER_MIN, lunchEndMin * MS_PER_MIN];
}

/**
 * 一天里「正常计薪」毫秒数的上限 = 上下班区间减去其中的午休交集。
 * 它同时是「已下班」的分界线：paidMs 一旦越过它，多出来的部分就是加班毫秒。
 */
export function normalPaidMsCap(settings: Settings): number {
  if (isMisconfigured(settings)) return 0;
  const start = settings.workStartMin * MS_PER_MIN;
  const end = settings.workEndMin * MS_PER_MIN;
  let lunch = 0;
  const window = lunchWindowMs(settings);
  if (window) lunch = Math.max(0, Math.min(end, window[1]) - Math.max(start, window[0]));
  return Math.max(0, end - start - lunch);
}

/** 一段计薪时长拆成两段整数毫秒：正常时段（封顶 = 全天计薪长）与加班时段。 */
export interface PaidSplit {
  normalMs: number;
  overtimeMs: number;
}

/**
 * paidMs 拆成正常 / 加班两段。
 * 为什么拆得出来：paidMsOf 的正常部分封顶就是 normalPaidMsCap，只有「勾了加班模式且已过下班点」
 * 才会多出来 —— 于是「多出来的毫秒」恰好就是加班毫秒，不需要额外的时钟参数。
 *
 * 没勾加班模式时一律按正常时段全额计：那种情况下 paidMsOf 本来就到不了 cap，
 * 而历史调用方（回放 / 单测）喂进来的长 paidMs 也不该被悄悄截断成打折的金额。
 */
export function splitPaidMs(settings: Settings, paidMs: number): PaidSplit {
  if (paidMs <= 0) return { normalMs: 0, overtimeMs: 0 };
  if (!settings.overtimeMode) return { normalMs: paidMs, overtimeMs: 0 };
  const cap = normalPaidMsCap(settings);
  if (paidMs <= cap) return { normalMs: paidMs, overtimeMs: 0 };
  return { normalMs: cap, overtimeMs: paidMs - cap };
}

/**
 * 正常时段的价率分子 / 分母：atoms = numerator * ms / denominator（只除一次）。
 * 推导见 earnedAtoms 的注释；salaryMicro 是微元，5 / 18 是两个整常数因子（时薪 → 每毫秒的换算）。
 */
function rateParts(settings: Settings): [bigint, bigint] {
  return [settings.salaryMicro * 5n * ATOMS_PER_YUAN, settings.payDaysMicro * settings.hoursMicro * 18n];
}

/** 正常时段 ms 毫秒的金额（不含任何加班加成）：时薪换算与「倍数 1.0」都用它。 */
export function normalAtoms(settings: Settings, ms: number): bigint {
  if (isMisconfigured(settings) || ms <= 0 || settings.payDaysMicro <= 0n || settings.hoursMicro <= 0n) return 0n;
  const [numerator, denominator] = rateParts(settings);
  return (numerator * BigInt(ms)) / denominator;
}

/**
 * 固定总额是否已经到账：勾了加班模式、并且这一天的正常计薪时长已经走满
 * （= 下班那一刻起，含恰好 18:00:00.000 这一帧）。
 * 它是纯函数、不累加任何状态 —— 于是「跨天重置」与「同一时刻重算」天然幂等，绝不会加第二次。
 */
export function fixedTotalDue(settings: Settings, paidMs: number): boolean {
  if (!settings.overtimeMode) return false;
  const cap = normalPaidMsCap(settings);
  return cap > 0 && paidMs >= cap;
}

/**
 * 今天的收入（atoms，1 atom = 1e-18 元）。
 *
 * 纪律：先把整数毫秒拼成一个分子，最后只做一次整除 —— 全程 BigInt，没有一帧浮点累加，
 * 因此同一个 paidMs 永远得到同一个 atoms（可重放、可与手算对齐）。
 *
 * 正常时段 = numerator * ms / denominator，其中
 * numerator = salaryMicro * 5 * 1e18、denominator = payDaysMicro * hoursMicro * 18
 * （月薪 / 计薪天数 = 日薪，日薪 / 日工时 = 时薪，时薪 / 3.6e6 ms 即每毫秒；常数 5 / 18 就是这条链上的整因子）。
 *
 * 加班时段按 overtimePayOf(settings) 三选一：
 * - multiplier：加班毫秒先乘上倍数（放大 1e6 的整数倍），与正常毫秒一起通分到 denominator * 1e6；
 * - fixedHourly：加班时段改用固定时薪（valueMicro 元 / 小时），通分到 denominator * 1e6 * 3.6e6；
 * - fixedTotal：加班时段按正常时薪继续累计，另外在下班那一刻一次性加上 valueMicro 元
 *   （1 元 = 1e18 atoms、1 微元 = 1e-6 元，所以一次性金额恰好是 valueMicro * 1e12，精确无余数）。
 */
export function earnedAtoms(settings: Settings, paidMs: number): bigint {
  if (isMisconfigured(settings) || paidMs <= 0 || settings.payDaysMicro <= 0n || settings.hoursMicro <= 0n) return 0n;
  const { normalMs, overtimeMs } = splitPaidMs(settings, paidMs);
  const [numerator, denominator] = rateParts(settings);
  const pay = overtimePayOf(settings);

  if (pay.mode === "fixedHourly") {
    // 固定时薪：加班金额 = valueMicro 元/小时 × 加班毫秒，通分到 denominator * 1e6 * 3.6e6。
    const total =
      numerator * BigInt(normalMs) * MICRO * MS_PER_HOUR +
      pay.valueMicro * ATOMS_PER_YUAN * BigInt(overtimeMs) * denominator;
    return total / (denominator * MICRO * MS_PER_HOUR);
  }

  // 倍数制与固定总额的「时段部分」同构：fixedTotal 的加班时段按 1.0 倍（= 正常时薪）继续。
  const weight = pay.mode === "multiplier" ? pay.valueMicro : MICRO;
  const timeAtoms =
    (numerator * (BigInt(normalMs) * MICRO + BigInt(overtimeMs) * weight)) / (denominator * MICRO);
  if (pay.mode !== "fixedTotal") return timeAtoms;
  // 固定总额：一次性到账，与加班时长无关（不重复加，也不随时长放大）。
  const bonus = fixedTotalDue(settings, paidMs) ? (pay.valueMicro * ATOMS_PER_YUAN) / MICRO : 0n;
  return timeAtoms + bonus;
}

export function phaseOf(settings: Settings, nowMs: number): Phase {
  if (isMisconfigured(settings)) return "配置错误";
  const now = msOfDay(nowMs);
  const start = settings.workStartMin * MS_PER_MIN;
  const end = settings.workEndMin * MS_PER_MIN;
  if (now < start) return "未到上班时间";
  if (now >= end) return settings.overtimeMode ? "加班" : "已下班";
  const window = lunchWindowMs(settings);
  if (window && now >= window[0] && now < window[1]) return "午休";
  return "在岗";
}

export function paidMsOf(settings: Settings, nowMs: number): number {
  if (isMisconfigured(settings)) return 0;
  const now = msOfDay(nowMs);
  const start = settings.workStartMin * MS_PER_MIN;
  const end = settings.workEndMin * MS_PER_MIN;
  if (now <= start) return 0;

  const worked = Math.min(now, end) - start;
  let lunch = 0;
  const window = lunchWindowMs(settings);
  if (window) {
    const from = Math.max(start, window[0]);
    const to = Math.min(Math.min(now, end), window[1]);
    lunch = Math.max(0, to - from);
  }
  const overtime = settings.overtimeMode && now > end ? now - end : 0;
  return Math.max(0, worked - lunch) + overtime;
}
