/*
 * 点击气泡：纯文本浮层（零素材）。
 *
 * 三条纪律：
 * 1) 绝对定位 + pointer-events: none —— 不撑开卡片、不挡拖动/点击判定；
 * 2) 不参与卡片的果冻形变（它是 .bar 的兄弟节点，不在被 transform 的那棵子树里），文字永远不会被拉变形；
 * 3) 全部动效交给 CSS：出现 / 淡出都是 keyframes，卸载靠父组件换 key 重挂载，
 *    所以一次点击只有一次 setState，绝没有逐帧 setState、也没有到点再 setState 一次。
 */
interface ClickFeedbackProps {
  /** 要显示的一行字（吐槽短句，或"今日第 N 次摸鱼"）。 */
  text: string;
}

export function ClickFeedback({ text }: ClickFeedbackProps) {
  return (
    <div className="bar-bubble" aria-hidden="true">
      <span className="bar-bubble-text">{text}</span>
    </div>
  );
}
