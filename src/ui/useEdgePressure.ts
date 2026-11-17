import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { beginEdgeWatch, endEdgeWatch, listenPayload } from "../settings/bridge";
import {
  REBOUND_MS,
  edgeCompression,
  edgesFromPayload,
  isIdentity,
  reboundFrames,
  transformCss,
  transformOriginCss,
  type EdgeEventPayload,
  type EdgeTransform,
} from "./edgePressure";

/** Rust 观察线程的两个事件（见 src-tauri/src/edge_watch.rs）。 */
export const EDGE_EVENT = "bar:edge";
export const EDGE_END_EVENT = "bar:edge-end";

/** 点击果冻的两套 keyframes（styles.css 的 bar-jelly-a / bar-jelly-b）。 */
const JELLY_ANIMATION_PREFIX = "bar-jelly";

function jellyRunning(element: HTMLElement): boolean {
  if (typeof element.getAnimations !== "function") return false;
  return element.getAnimations().some((animation) => {
    const name = (animation as Animation & { animationName?: string }).animationName;
    return typeof name === "string" && name.indexOf(JELLY_ANIMATION_PREFIX) === 0;
  });
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface EdgePressureHandle {
  /** 发起拖动之前调一次：Rust 侧起观察线程，替 webview 盯着位置和松手。 */
  begin(): void;
  /**
   * 立刻结束观察（右键按下 / 右键拖动开始时调）：让左键那条通道彻底让位，
   * 保证同一时刻只有一条线程在推动窗口。形变与回弹一并归位。
   */
  cancel(): void;
}

/**
 * 拖动贴边的形变通道。
 *
 * 分工：
 * - 位置与"松手"由 Rust 观察线程判定（拖动期间 webview 收不到任何鼠标事件），它 emit
 *   bar:edge（贴边位置）与 bar:edge-end（松手）；
 * - 这里只写 DOM 的 style.transform / transform-origin，**一次 setState 都没有**：
 *   60Hz 的事件流下 React 完全不参与；
 * - 松手回弹用 Web Animations API 播 500ms（过冲 4% 再回正），与点击果冻共用同一套语言，
 *   但两个通道互斥：点击永远优先（按下即取消回弹；果冻正在播就跳过回弹）。
 */
export function useEdgePressure(barRef: RefObject<HTMLElement | null>): EdgePressureHandle {
  /** 当前写在 DOM 上的压缩量（null = 恒等）。 */
  const current = useRef<EdgeTransform | null>(null);
  /** 正在播的回弹动画。 */
  const rebound = useRef<Animation | null>(null);

  const clear = useCallback((element: HTMLElement | null) => {
    current.current = null;
    if (element === null) return;
    element.style.transform = "";
    element.style.transformOrigin = "";
    element.style.willChange = "";
  }, []);

  const paint = useCallback(
    (element: HTMLElement, transform: EdgeTransform) => {
      if (isIdentity(transform)) {
        clear(element);
        return;
      }
      element.style.transformOrigin = transformOriginCss(transform);
      element.style.transform = transformCss(transform);
      element.style.willChange = "transform";
      current.current = transform;
    },
    [clear],
  );

  const cancelRebound = useCallback(() => {
    const animation = rebound.current;
    rebound.current = null;
    if (animation === null) return;
    animation.onfinish = null;
    animation.cancel();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    const handleEdge = (payload: EdgeEventPayload | null) => {
      const element = barRef.current;
      if (disposed || element === null) return;
      // 新一次拖动的位置到了：上一次的回弹立刻让位。
      cancelRebound();
      paint(element, edgeCompression(edgesFromPayload(payload)));
    };

    const handleEnd = () => {
      const element = barRef.current;
      if (disposed || element === null) return;
      cancelRebound();
      const start = current.current;
      if (start === null || isIdentity(start)) {
        clear(element);
        return;
      }
      // 点击果冻优先 / 减弱动效 / 没有 WAAPI：直接归位，绝不让两份动画抢同一个 transform。
      if (prefersReducedMotion() || jellyRunning(element) || typeof element.animate !== "function") {
        clear(element);
        return;
      }
      const frames = reboundFrames(start);
      const animation = element.animate(
        frames.map((frame) => ({
          offset: frame.offset,
          transform: "scale(" + frame.sx.toFixed(4) + ", " + frame.sy.toFixed(4) + ")",
        })),
        { duration: REBOUND_MS, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)", fill: "none" },
      );
      // 内联 transform 让位给动画（动画本来就压过内联样式）；原点留在被压的边/角落，
      // 回弹才是"从压住的边弹回来"，而不是整块卡片往中间漂。
      element.style.transform = "";
      element.style.transformOrigin = transformOriginCss(start);
      element.style.willChange = "transform";
      current.current = null;
      rebound.current = animation;
      animation.onfinish = () => {
        if (rebound.current === animation) rebound.current = null;
        clear(element);
      };
    };

    // 新的按下手势：上一次的压缩（end 事件万一丢了）与正在播的回弹都立刻让位。
    const handlePointerDown = () => {
      cancelRebound();
      if (current.current !== null) clear(barRef.current);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("pointerdown", handlePointerDown, true);
    }

    void (async () => {
      const offEdge = await listenPayload<EdgeEventPayload | null>(EDGE_EVENT, handleEdge);
      const offEnd = await listenPayload<null>(EDGE_END_EVENT, handleEnd);
      if (disposed) {
        offEdge();
        offEnd();
        return;
      }
      unsubscribe = () => {
        offEdge();
        offEnd();
      };
    })();

    return () => {
      disposed = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("pointerdown", handlePointerDown, true);
      }
      unsubscribe?.();
      cancelRebound();
      clear(barRef.current);
      // 组件卸载时也把 Rust 侧线程收掉（它自己 30 秒看门狗也会灭，但不必等那么久）。
      endEdgeWatch();
    };
  }, [barRef, cancelRebound, clear, paint]);

  return useMemo<EdgePressureHandle>(
    () => ({
      begin() {
        // 减弱动效：只关掉"窗口被弹走"，形变回弹那边另有自己的判定。
        beginEdgeWatch({ bounce: !prefersReducedMotion() });
      },
      cancel() {
        // 代次 +1：观察线程下一个 tick 就退出，且它是"被顶掉"路线 —— 不发 bar:edge-end，不会弹走。
        endEdgeWatch();
        cancelRebound();
        clear(barRef.current);
      },
    }),
    [barRef, cancelRebound, clear],
  );
}