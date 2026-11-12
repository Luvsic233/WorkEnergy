/*
 * 吉祥物状态机。
 *
 * 动画纪律：notify 每帧被 ticker 调用，但它只写 ref —— 没有任何每帧 setState；
 * 只有在"状态真的变了"（阶段切换 / 跨过整数元）时才 setState 一次。
 * 表现层的动效全部由 CSS animation 完成（见 styles.css 的 .bar-mascot），React 不参与逐帧。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Phase } from "../core/earning";
import { MILESTONE_VISIBLE_MS, crossedYuan, integerYuanOf, mascotStateOf } from "./mascot";
import type { MascotState, Theme } from "./types";

export interface MascotBinding {
  state: MascotState;
  /** 每帧调一次：只更新 ref，状态变化时才 setState。 */
  notify(moneyInt: string, phase: Phase): void;
}

export function useMascot(theme: Theme | null): MascotBinding {
  const [state, setState] = useState<MascotState>("idle");
  const stateRef = useRef<MascotState>("idle");
  const phaseRef = useRef<Phase>("在岗");
  const yuanRef = useRef<bigint | null>(null);
  const lastIntRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMascot = theme !== null && theme.mascot !== null;

  const paint = useCallback((next: MascotState) => {
    if (stateRef.current === next) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const notify = useCallback(
    (moneyInt: string, phase: Phase) => {
      phaseRef.current = phase;
      // 没有吉祥物的主题（默认 / 极简 / 用户没放图）：整条链路空转，零 setState。
      if (!hasMascot) return;

      if (moneyInt !== lastIntRef.current) {
        lastIntRef.current = moneyInt;
        const yuan = integerYuanOf(moneyInt);
        const crossed = yuan !== null && crossedYuan(yuanRef.current, yuan);
        yuanRef.current = yuan;
        if (crossed) {
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          paint("milestone");
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            paint(mascotStateOf(phaseRef.current));
          }, MILESTONE_VISIBLE_MS);
          return;
        }
      }

      // milestone 显示期间不抢状态：等计时结束回到"当前状态"。
      if (timerRef.current === null) paint(mascotStateOf(phase));
    },
    [hasMascot, paint],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  // 换主题时把基线与计时器复位：换到"有吉祥物"的主题上，第一帧不该立刻庆祝一次。
  useEffect(() => {
    yuanRef.current = null;
    lastIntRef.current = "";
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    paint("idle");
  }, [theme?.id, paint]);

  return { state, notify };
}
