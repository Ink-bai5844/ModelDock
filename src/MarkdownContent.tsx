import { Check, Copy } from "@phosphor-icons/react";
import {
  Children,
  isValidElement,
  type ReactNode,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (!isValidElement(node)) return "";
  return nodeText((node.props as { children?: ReactNode }).children);
}

function MarkdownPre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children)[0];
  const className = isValidElement(child)
    ? ((child.props as { className?: string }).className ?? "")
    : "";
  const language = /language-([^\s]+)/.exec(className)?.[1] ?? "code";
  const source = nodeText(children).replace(/\n$/, "");

  const copy = async () => {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="markdown-code-block">
      <div>
        <span>{language}</span>
        <button type="button" onClick={copy} aria-label="复制代码">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ alt, node: _node, ...props }) => (
            <img {...props} alt={alt ?? "Markdown 图片"} loading="lazy" />
          ),
          pre: MarkdownPre,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
