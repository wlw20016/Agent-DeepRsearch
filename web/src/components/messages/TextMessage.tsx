import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Message } from "../../types/messages";
import { Tag } from "antd";

type Props = {
  message: Extract<Message, { type: "text" }>;
  actions?: React.ReactNode;
};

export const TextMessage: React.FC<Props> = ({ message, actions }) => {
  const [displayedContent, setDisplayedContent] = useState(
    message.streaming ? "" : message.content
  );

  const roleColor =
    message.role === "user" ? "blue" : message.role === "system" ? "purple" : "green";

  // 当新消息到来时重置
  useEffect(() => {
    setDisplayedContent(message.streaming ? "" : message.content);
  }, [message.id, message.streaming, message.content]);

  // 当流消息到来时渲染打字机效果
  useEffect(() => {
    //就是说：这是历史消息，不再需要流式渲染了
    if (!message.streaming) {
      setDisplayedContent(message.content);
      return;
    }
    const target = message.content;
    let i = displayedContent.length;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      i = Math.min(i + 2, target.length);
      setDisplayedContent(target.slice(0, i));
      if (i < target.length) {
        setTimeout(tick, 14);
      }
    };

    if (i < target.length) tick();

    return () => {
      cancelled = true;
    };
  }, [message.content, message.streaming]);//消息内容变了，流式状态变了

  return (
    <div className="message text-message">
      <div className="message-header">
        <Tag color={roleColor}>{message.role.toUpperCase()}</Tag>
        {actions && <div className="message-inline-actions">{actions}</div>}
        {message.streaming && <span className="streaming-dot">···</span>}
      </div>
      <div className={`markdown-body ${message.streaming ? "streaming" : ""}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {displayedContent}
        </ReactMarkdown>
      </div>
    </div>
  );
};
