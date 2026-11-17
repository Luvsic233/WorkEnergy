import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import type { Phase, Settings } from "../core/earning";
import {
  DEFAULT_DECIMALS,
  formatMicro,
  type Decimals,
  type DigitColumn,
  type DigitColumns,
} from "../core/format";
import { DEFAULT_INPUT, type DisplayMode, type RefreshHz } from "../core/settings";
import { invoke, startDragging } from "../settings/bridge";
import { CELEBRATION_STEP, crossedMultiple } from "../theme/celebration";
import {
  counterLine,
  dayKey,
  defaultInteractionStore,
  isClickGesture,
  pickPhrase,
  readInteractionState,
  registerClick,
  writeInteractionState,
  type PointerMoment,
} from "../theme/interaction";
import { integerYuanOf } from "../theme/mascot";
import {
  defaultNotifyStore,
  markInteraction,
  markSent,
  pickProactiveMessage,
  readNotifyState,
  sentIdsOn,
  writeNotifyState,
} from "../theme/proactive";
import { lunchRatiosOf, timelineGeometry , remainingLabel } from "../theme/timeline";
import { MascotImage } from "../theme/MascotImage";
import { PhotoArt } from "../theme/PhotoArt";
import { layoutOf } from "../theme/layout";
import { useAdaptiveCardWidth } from "../theme/adaptiveWidth";
import type { Theme } from "../theme/types";
import { useMascot } from "../theme/useMascot";
import { BubbleChannel, type BubbleKind, type BubbleMessage } from "./ClickFeedback";
import { useEdgePressure } from "./useEdgePressure";
import { DigitCell, FracCell, type DigitCellHandle, type FracCellHandle } from "./RollingDigit";
import { startTicker } from "./ticker";

/**
 * 整数位的格子池：整数部分最多 12 位（薪资输入上限 12 位整数），多出来的高位由池子覆盖；
 * 前导零的格子由 DigitCell 收起（display: none），所以池子固定也不会显示多余的空位。
 */
const INT_SLOTS = 12;

/** 气泡显示时长：与 styles.css 的 click-bubble 动画时长一致（1200ms）。 */
const BUBBLE_MS = 1200;

/** 主动消息的判定节拍：每帧都算太浪费，1 秒一次足够追上任何"时刻"。 */
const PROACTIVE_CHECK_MS = 1000;

/** 手势时长用单调时钟：Date.now() 会被系统对时回拨，performance.now() 不会。 */
function gestureClock(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** × 这类可点击元素自己处理点击：按在它上面不进入「点击 / 拖动」判定。 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  if (typeof element?.closest !== "function") return false;
  return element.closest("button, input, a, textarea, select") !== null;
}

export interface RollingIntHandle {
  /** 逐帧把每一位推到它该停的整格；只碰 style，不进 React 状态。 */
  paint(columns: DigitColumns, nowMs: number): void;
}

export interface RollingFracHandle {
  /** 逐帧把每一位小数推到它的连续位置（digit + progress）：没有门限，每帧都推进。 */
  paint(columns: DigitColumn[]): void;
}

interface RollingIntProps {
  ref?: Ref<RollingIntHandle>;
}

/** 整数区：12 个一位格子，每一位常态精确停在整格上，只有数值变化时滚一格。 */
function RollingInt({ ref }: RollingIntProps) {
  const handles = useRef<(DigitCellHandle | null)[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      paint(columns, nowMs) {
        // 池子按最高位对齐：左边多出来的格子收起，剩下的格子对应 columns.int 从高到低。
        const offset = INT_SLOTS - columns.int.length;
        for (let slot = 0; slot < INT_SLOTS; slot += 1) {
          const column = columns.int[slot - offset];
          handles.current[slot]?.paint(column?.digit ?? 0, nowMs, column !== undefined);
        }
      },
    }),
    [],
  );

  return (
    <span className="int-group">
      {Array.from({ length: INT_SLOTS }, (_, slot) => (
        <DigitCell
          key={slot}
          pos={INT_SLOTS - 1 - slot}
          ref={(handle) => {
            handles.current[slot] = handle;
          }}
        />
      ))}
    </span>
  );
}

interface RollingFracProps {
  /** 小数位数档位：格子数跟着档位走（18 / 12 / 6）。 */
  decimals: Decimals;
  ref?: Ref<RollingFracHandle>;
}

/**
 * 小数区：每位一个滚条格子，位移由 {digit, progress} 连续算出。
 * 一圈滚条后面永远是下一格，所以这一排读起来是一条不停向下流的尾巴，而不是"滚一段停一拍"。
 */
function RollingFrac({ decimals, ref }: RollingFracProps) {
  const handles = useRef<(FracCellHandle | null)[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      paint(columns) {
        for (let index = 0; index < handles.current.length; index += 1) {
          const column = columns[index];
          handles.current[index]?.paint(column ?? { digit: 0, progress: 0 }, column !== undefined);
        }
      },
    }),
    [],
  );

  return (
    <span className="frac-group">
      {Array.from({ length: decimals }, (_, index) => (
        <FracCell
          key={index}
          fpos={index + 1}
          ref={(handle) => {
            handles.current[index] = handle;
          }}
        />
      ))}
    </span>
  );
}

/** 气泡槽里的一条：气泡消息本身 + 它对应的果冻帧号（只有点击会推进，见 showBubble）。 */
interface BubbleSlot extends BubbleMessage {
  fx: number;
}

interface FloatingBarProps {
  settings: Settings;
  decimals?: Decimals;
  /** 跳动频率档位（默认 10Hz）：只决定 jump 模式整串跳变的频率，roll 模式不看它。 */
  refreshHz?: RefreshHz;
  displayMode?: DisplayMode;
  /**
   * 当前主题：配色与字体由 CSS 变量决定（见 src/theme/css.ts）；
   * 另外内置 maodie 主题带 layout = photo-left，按它切换整条版式。
   */
  theme?: Theme | null;
  now?: () => number;
}

export function FloatingBar({
  settings,
  decimals = DEFAULT_DECIMALS,
  refreshHz = DEFAULT_INPUT.refreshHz,
  displayMode = DEFAULT_INPUT.displayMode,
  theme = null,
  now,
}: FloatingBarProps) {
  const rollerRef = useRef<RollingIntHandle>(null);
  const fracRollerRef = useRef<RollingFracHandle>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const intRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  // 拖动贴边的形变通道：位置与松手都由 Rust 观察线程报上来（拖动期间 webview 收不到鼠标事件），
  // 这里只往 .bar 上写 transform，一次 setState 都没有。
  const edgePressure = useEdgePressure(barRef);
  // 吉祥物状态机：notify 只写 ref，状态真的变化时才 setState 一次（无吉祥物的主题整条链路空转）。
  const mascot = useMascot(theme);
  const mascotNotify = mascot.notify;
  // 庆祝弹窗的 20 元台阶：与吉祥物同一套纪律 —— 只在整数文本变化时比一次 BigInt，
  // 跨过台阶才 invoke 一次，其余帧零 IPC、零字符串拼接。
  const celebrateIntRef = useRef("");
  const celebrateYuanRef = useRef<bigint | null>(null);
  const notifyCelebration = useCallback((moneyInt: string) => {
    if (moneyInt === celebrateIntRef.current) return;
    celebrateIntRef.current = moneyInt;
    const yuan = integerYuanOf(moneyInt);
    const crossed = yuan !== null && crossedMultiple(celebrateYuanRef.current, yuan, CELEBRATION_STEP);
    celebrateYuanRef.current = yuan;
    if (crossed) void invoke("show_celebration");
  }, []);
  // photo-left 版式的窗口宽度跟着内容走（其余版式整条链路空转）。
  const isPhotoLeft = layoutOf(theme) === "photo-left";
  const adaptive = useAdaptiveCardWidth(isPhotoLeft, { bar: barRef, main: mainRef });
  const adaptiveNote = adaptive.note;

  const handleContextMenu = (event: { preventDefault(): void }) => {
    // 关掉 WebView2 默认右键菜单，换成 Rust 侧弹出的原生菜单。
    event.preventDefault();
    void invoke("show_bar_menu");
  };

  /*
   * 左键点击互动（零新增素材）。
   *
   * 手势判定：按下只记坐标；松开时「位移 < 4px 且时长 < 500ms」才算点击，位移一旦越过 4px
   * 就立刻 startDragging() 把窗口交给 OS 拖动，这一次手势从此不再算点击。
   * 为什么不用 data-tauri-drag-region：真机实测它会在 mousedown 当场把控制权交给 OS 窗口移动循环，
   * webview 之后连 pointerup / mouseup / click 都收不到（一次真实点击只到 pointerdown + mousedown），
   * 于是「按下→松开算点击」根本无从判定 —— 所以拖动改成由这里按阈值主动发起。
   *
   * 动画纪律：一次点击只 setState 一次（气泡文案 + 一个自增 token）。token 的奇偶映射成
   * data-fx="a|b"，CSS 换一个 animation-name 就是重播一遍动画：没有逐帧 setState，
   * 也没有「到点再 setState 收起气泡」（淡出由 keyframes 的 fill 收尾）。
   */
  const [bubble, setBubble] = useState<BubbleSlot | null>(null);
  const tokenRef = useRef(0);
  // 果冻形变的帧号：只有点击推进它。猫自己说话时不抖卡片，点击-形变的一一对应也就不受影响。
  const fxRef = useRef(0);
  const pressRef = useRef<PointerMoment | null>(null);
  const draggingRef = useRef(false);
  /*
   * 气泡槽（唯一一条）：点击吐槽与主动气泡共用它。
   * bubbleBusyUntil 是当前那条的占用截止时刻（单调时钟，与 CSS 动画同一个 1200ms）；
   * 主动消息撞上正在播的气泡时排队等它播完，绝不两条叠在一起。
   */
  const bubbleBusyUntilRef = useRef(0);
  const pendingBubbleRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  // 底部时间轴：只写 dot 的 style.left 与两个 data-*，一帧都没有 setState。
  const timelineRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timelineMarkRef = useRef("");
  // 主动气泡的判定基线：checkedAt 是上一次判定的时刻（null = 刚启动，这一轮只建立基线）。
  const proactiveRef = useRef<{ checkedAt: number | null; interactionAt: number | null | undefined }>({
    checkedAt: null,
    interactionAt: undefined,
  });

  const showBubble = useCallback((text: string, kind: BubbleKind) => {
    tokenRef.current += 1;
    if (kind === "click") fxRef.current += 1;
    bubbleBusyUntilRef.current = gestureClock() + BUBBLE_MS;
    setBubble({ token: tokenRef.current, text, kind, fx: fxRef.current });
  }, []);

  /**
   * 主动消息专用入口：气泡槽被占着就排队（单槽，后来的覆盖先来的），等当前那条播完再接上。
   * 选"排队"而不是"丢弃"：每条消息每天只有一次机会，丢掉就真的永远看不到了。
   */
  const sayWhenFree = useCallback(
    (text: string) => {
      const wait = bubbleBusyUntilRef.current - gestureClock();
      if (wait <= 0) {
        showBubble(text, "proactive");
        return;
      }
      pendingBubbleRef.current = text;
      if (pendingTimerRef.current !== null) return;
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        const pending = pendingBubbleRef.current;
        pendingBubbleRef.current = null;
        if (pending !== null) showBubble(pending, "proactive");
      }, wait);
    },
    [showBubble],
  );

  useEffect(
    () => () => {
      if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    },
    [],
  );

  const runInteraction = useCallback(() => {
    // 计数：读 → 加一 → 写回。独立存储键（workenergy.interactions.v1），不污染 settings。
    const at = Date.now();
    const day = dayKey(at);
    const store = defaultInteractionStore();
    const { state, milestone } = registerClick(readInteractionState(store), day);
    writeInteractionState(store, state);
    // 点击也算"互动"：把主动气泡的计时一起推到现在（独立存储键 workenergy.notify.v1）。
    const notifyStore = defaultNotifyStore();
    writeNotifyState(notifyStore, markInteraction(readNotifyState(notifyStore), at));
    proactiveRef.current.interactionAt = at;
    // 每 5 次把计数写进气泡，其余次数冒一句吐槽；点击永远立刻显示（主动消息只有排队的份）。
    showBubble(counterLine(state.today) ?? pickPhrase(Math.random()), "click");
    // 里程碑：复用现有的庆祝弹窗命令，每个档位只弹一次（已弹过的档位持久化在同一个键里）。
    if (milestone !== null) void invoke("show_celebration");
  }, [showBubble]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return; // 只认左键
    draggingRef.current = false;
    pressRef.current = null;
    if (isInteractiveTarget(event.target)) return; // × 自己处理点击
    pressRef.current = { x: event.clientX, y: event.clientY, t: gestureClock() };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const down = pressRef.current;
    if (down === null || draggingRef.current) return;
    if ((event.buttons & 1) === 0) {
      pressRef.current = null; // 松开事件丢了：这次手势作废，绝不猜。
      return;
    }
    // 时长传 0：这里只问「位移是否还在 4px 以内」。
    if (isClickGesture(down, { x: event.clientX, y: event.clientY, t: down.t })) return;
    draggingRef.current = true;
    pressRef.current = null;
    // 先开观察、再把控制权交给 OS：移动循环一开，webview 就收不到 pointerup 了。
    edgePressure.begin();
    startDragging();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const down = pressRef.current;
    pressRef.current = null;
    if (down === null || draggingRef.current || event.button !== 0) return;
    if (!isClickGesture(down, { x: event.clientX, y: event.clientY, t: gestureClock() })) return;
    runInteraction();
  };

  const handlePointerCancel = () => {
    pressRef.current = null;
    draggingRef.current = false;
  };

  // a / b 交替：同一个 animation-name 无法重复播放，换个名字就是重播（同一次点击只改一次属性）。
  // fx === 0 说明这次不是点击（或还没点过）：不发任何形变，data-fx 保持原样。
  const fx = bubble === null || bubble.fx === 0 ? null : bubble.fx % 2 === 0 ? "b" : "a";
  // 手势全部挂在最外层（整块卡片 + 透明边距），两种版式共用同一份判定。
  const barHostProps = {
    className: "bar-host",
    "data-fx": fx ?? undefined,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onContextMenu: handleContextMenu,
  };

  /*
   * 主动气泡的判定（每秒最多一次，全部由注入的时刻推算，没有写死的钟点）：
   * - 第一次只建立基线，启动时绝不补发今天已经过去的时刻；
   * - 命中就记进 workenergy.notify.v1（该条今天不再发），并把"上次互动"推到这一刻；
   * - 气泡槽被点击吐槽占着时排队，等它播完再说，两条永不叠在一起。
   */
  const noteProactive = useCallback(
    (phase: Phase, nowMs: number) => {
      const state = proactiveRef.current;
      if (state.checkedAt !== null && nowMs - state.checkedAt < PROACTIVE_CHECK_MS) return;
      const store = defaultNotifyStore();
      const stored = readNotifyState(store);
      if (state.interactionAt === undefined) state.interactionAt = stored.lastInteractionAt;
      const day = dayKey(nowMs);
      const message = pickProactiveMessage({
        settings,
        now: nowMs,
        phase,
        lastInteractionAt: state.interactionAt,
        sent: sentIdsOn(stored, day),
        checkedAt: state.checkedAt,
      });
      state.checkedAt = nowMs;
      if (message === null) return;
      writeNotifyState(store, markSent(stored, day, message.id, nowMs));
      state.interactionAt = nowMs;
      sayWhenFree(message.text);
    },
    [settings, sayWhenFree],
  );

  useEffect(() => {
    const host = {
      now: now ?? Date.now,
      schedule: (callback: () => void) => requestAnimationFrame(callback),
      cancel: (handle: number) => cancelAnimationFrame(handle),
    };
    let lastPhase = "";
    // 每帧只写 ref 的 style.transform / textContent，绝不 setState：60fps 下 React 完全不参与。
    return startTicker(
      host,
      settings,
      ({ money, phase, columns, nowMs }) => {
        if (displayMode === "roll") {
          // 整数：每位推到整格，数值变化时由进位状态机自己滚一格。
          rollerRef.current?.paint(columns, nowMs);
          // 小数：每帧都按 atoms 的真实连续进度（digit + progress）推进，没有任何门限。
          fracRollerRef.current?.paint(columns.frac);
        } else {
          // jump：整数与小数一起按 refreshHz 整片跳，没有任何动画。
          if (intRef.current) intRef.current.textContent = money.int;
          if (fracRef.current) fracRef.current.textContent = money.frac;
        }
        // 阶段文字带上剩余时间（「在岗 · 剩 3:12」）：时间轴只有一条线不容易看懂，这行字把它解释清楚。
        // 整串变了才写 DOM（每分钟一次，不是每帧）。
        const rest = remainingLabel(settings, nowMs);
        const phaseText = rest === null ? phase : `${phase} · ${rest}`;
        if (phaseText !== lastPhase) {
          lastPhase = phaseText;
          if (phaseRef.current) phaseRef.current.textContent = phaseText;
        }
        // 吉祥物：只把整数元文本与阶段交给状态机，滚轮与引擎一行没动。
        mascotNotify(money.int, phase);
        // 庆祝弹窗：同一份整数文本，跨过 20 元台阶时弹一次。
        notifyCelebration(money.int);
        // 自适应宽度：只在整数位数变化（并稳定若干帧）时才下发一次窗口尺寸。
        adaptiveNote(money.int);
        // 底部时间轴：纯几何，只写圆点的 style.left 与两个 data-*（值没变就不碰 DOM）。
        const geometry = timelineGeometry(settings, nowMs);
        if (dotRef.current) dotRef.current.style.left = `${(geometry.progress * 100).toFixed(2)}%`;
        if (fillRef.current) fillRef.current.style.width = `${(geometry.progress * 100).toFixed(2)}%`;
        const timeline = timelineRef.current;
        if (timeline !== null) {
          const overtime = phase === "加班";
          const mark = `${geometry.state}:${overtime ? "1" : "0"}`;
          if (timelineMarkRef.current !== mark) {
            timelineMarkRef.current = mark;
            timeline.dataset.state = geometry.state;
            if (overtime) timeline.dataset.overtime = "true";
            else delete timeline.dataset.overtime;
          }
        }
        // 主动气泡：每秒一次判定，用的就是这一帧的阶段与时刻（与阶段文字同源，不会自相矛盾）。
        noteProactive(phase, nowMs);
      },
      { refreshHz, decimals, displayMode },
    );
  }, [
    settings,
    decimals,
    refreshHz,
    displayMode,
    now,
    mascotNotify,
    adaptiveNote,
    notifyCelebration,
    noteProactive,
  ]);

  // 两个版式共用的两块：数字区与阶段文字（滚轮 / ticker / 每帧 paint 一行都没动）。
  const valueBlock = (
    /* data-decimals / data-mode 给 CSS 用：按档位收窄字号、按显示方式切换对齐，保证条宽内不溢出。 */
    <div className="bar-value" data-decimals={decimals} data-mode={displayMode}>
      {displayMode === "roll" ? <RollingInt ref={rollerRef} /> : <span className="int" ref={intRef}>0</span>}
      <span className="dot">.</span>
      {displayMode === "roll" ? (
        <RollingFrac decimals={decimals} ref={fracRollerRef} />
      ) : (
        <span className="frac" ref={fracRef}>
          {"0".repeat(decimals)}
        </span>
      )}
      <span className="unit">元</span>
    </div>
  );
  const phaseBlock = (
    <span className="phase" ref={phaseRef}>
      —
    </span>
  );

  const closeButton = (
    <button
      type="button"
      className="bar-close"
      aria-label="隐藏到托盘"
      title="隐藏到托盘"
      onClick={() => {
        void invoke("hide_main");
      }}
    >
      ×
    </button>
  );

  /*
   * 底部时间轴：绝对定位的 3px 细线（不参与任何布局 ⇒ 卡片高度一个像素都不会变，
   * 圆点也不会挤掉任何一行字）。轨道上的午休缺口由两个 CSS 变量描述（几何一算好就写进 style，
   * 不随帧变化），圆点位置每帧由 ticker 直接写 style.left。
   */
  const lunchGap = lunchRatiosOf(settings);
  const timelineStyle =
    lunchGap === null
      ? undefined
      : ({
          "--lunch-from": `${(lunchGap.from * 100).toFixed(3)}%`,
          "--lunch-to": `${(lunchGap.to * 100).toFixed(3)}%`,
        } as CSSProperties);
  const timelineBlock = (
    <div className="bar-timeline" ref={timelineRef} style={timelineStyle} data-state="working" aria-hidden="true">
      <span className="bar-timeline-rail" />
        <span className="bar-timeline-fill" ref={fillRef} />
      <span className="bar-timeline-dot" ref={dotRef} />
    </div>
  );

  /*
   * 外层 .bar-host 是手势与动画的锚点：
   * - 手势（按下/移动/松开、右键）都挂在这里，两种版式共用同一份判定；
   * - data-fx=a|b 只负责"重播一遍动画"（换 animation-name），不携带任何样式；
   * - 气泡是 .bar 的兄弟节点，不在被 transform 的那棵子树里，所以文字永远不会被果冻形变拉变形。
   * 注意：这里已经不再有 data-tauri-drag-region —— 拖动改由上面按 4px 阈值发起（见注释）。
   */
  // photo-left（内置 maodie）：左侧一张按条高缩放的图（右缘渐变淡出），右侧只有标签 + 金额 + 阶段。
  if (layoutOf(theme) === "photo-left") {
    return (
      <div {...barHostProps} data-layout="photo-left">
        <div ref={barRef} className="bar" data-layout="photo-left">
          {closeButton}
          <PhotoArt state={mascot.state} />
          <div className="bar-photo-main" ref={mainRef}>
            <div className="bar-label">今日老板欠我</div>
            {valueBlock}
            <div className="bar-foot">{phaseBlock}</div>
          </div>
          {timelineBlock}
        </div>
        <BubbleChannel bubble={bubble} />
      </div>
    );
  }

  return (
    <div {...barHostProps}>
      <div ref={barRef} className="bar">
        {closeButton}
        <div className="bar-label">今日老板欠我</div>
        {valueBlock}
        <div className="bar-foot">
          {phaseBlock}
          <div className="bar-foot-meta">
            <span className="hint">
              {formatMicro(settings.salaryMicro)} 元 / {formatMicro(settings.payDaysMicro)} 天 / {formatMicro(settings.hoursMicro)} 小时
            </span>
            <MascotImage theme={theme} state={mascot.state} />
          </div>
        </div>
        {timelineBlock}
      </div>
      <BubbleChannel bubble={bubble} />
    </div>
  );
}
