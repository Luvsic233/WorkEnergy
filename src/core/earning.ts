export const ATOMS_PER_YUAN = 10n ** 18n;

const MICRO = 1_000_000n;
const MS_PER_MIN = 60_000;

export interface Settings {
  salaryMicro: bigint;
  payDaysMicro: bigint;
  hoursMicro: bigint;
  workStartMin: number;
  workEndMin: number;
  lunchStartMin: number | null;
  lunchEndMin: number | null;
  overtimeMode: boolean;
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
  };
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

export function earnedAtoms(settings: Settings, paidMs: number): bigint {
  if (isMisconfigured(settings) || paidMs <= 0 || settings.payDaysMicro <= 0n || settings.hoursMicro <= 0n) return 0n;
  return (settings.salaryMicro * BigInt(paidMs) * 5n * ATOMS_PER_YUAN) / (settings.payDaysMicro * settings.hoursMicro * 18n);
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
