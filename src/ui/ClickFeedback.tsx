/*
 * 点击气泡：纯文本浮层（零素材）。
 *
 * 三条纪律：
 * 1) 绝对定位 + pointer-events: none —— 不撑开卡片、不挡拖动/点击判定；
 * 2) 不参与卡片的果冻形变（它是 .bar 的兄弟节点，不在被 transform 的那棵子树里），文字永远不会被拉变形；
 * 3) 全部动效交给 CSS：出现 / 淡出都是 keyframes，卸载靠父组件换 key 重挂载，
 *    所以一次点击只有一次 setState，绝没有逐帧 setState、也没有到点再 setState 一次。
 *
 * 主动气泡（猫自己找时机说话）复用同一个组件与同一套动画，只是多一个 kind 标记：
 * 视觉与时长完全一致，唯一区别是"这次是谁开口"（见 BubbleChannel）。
 */

/** 气泡的来源：点击吐槽 / 主动说话。只是标记，不影响任何样式。 */
export type BubbleKind = "click" | "proactive";

/** 气泡槽里的一条消息：token 变了就重挂载（CSS keyframes 从头播一遍）。 */
export interface BubbleMessage {
  token: number;
  text: string;
  kind?: BubbleKind;
}

interface ClickFeedbackProps {
  /** 要显示的一行字（吐槽短句、"今日第 N 次摸鱼"，或主动气泡）。 */
  text: string;
  /** 谁在说话（可选）：只写一个 data-kind，方便取证与调试。 */
  kind?: BubbleKind;
}

export function ClickFeedback({ text, kind }: ClickFeedbackProps) {
  return (
    <div className="bar-bubble" data-kind={kind} aria-hidden="true">
      <span className="bar-bubble-text">{text}</span>
    </div>
  );
}

/**
 * 气泡通道：点击吐槽与主动气泡共用这**唯一**一个气泡槽。
 *
 * 父组件保证同一时刻只有一条消息（排队的主动消息等当前气泡播完再接上），
 * 这里只负责"换 token 就重挂载"，所以永远不会出现两条气泡叠在一起。
 */
export function BubbleChannel({ bubble }: { bubble: BubbleMessage | null }) {
  if (bubble === null) return null;
  return <ClickFeedback key={bubble.token} text={bubble.text} kind={bubble.kind} />;
}
