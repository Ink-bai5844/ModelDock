import {
  CaretDown,
  CircleNotch,
  TreeStructure,
} from "@phosphor-icons/react";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";

const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

interface ReasoningPanelProps {
  content: string;
  isStreaming: boolean;
  hasAnswer: boolean;
}

export function ReasoningPanel({
  content,
  isStreaming,
  hasAnswer,
}: ReasoningPanelProps) {
  const [open, setOpen] = useState(isStreaming && !hasAnswer);
  const autoCollapsed = useRef(false);

  useEffect(() => {
    if (isStreaming && !hasAnswer && !autoCollapsed.current) {
      setOpen(true);
      return;
    }
    if (hasAnswer && !autoCollapsed.current) {
      autoCollapsed.current = true;
      setOpen(false);
    }
  }, [hasAnswer, isStreaming]);

  return (
    <details
      className="reasoning-panel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="reasoning-mark">
          {isStreaming && !hasAnswer ? (
            <CircleNotch className="spin" size={15} />
          ) : (
            <TreeStructure size={15} />
          )}
        </span>
        <span>
          <strong>{isStreaming && !hasAnswer ? "正在思考" : "思考过程"}</strong>
          <small>{open ? "收起内容" : "展开查看"}</small>
        </span>
        <CaretDown className="reasoning-caret" size={14} />
      </summary>
      <div className="reasoning-content">
        <Suspense fallback={<span className="markdown-loading">{content}</span>}>
          <MarkdownContent content={content} />
        </Suspense>
      </div>
    </details>
  );
}
