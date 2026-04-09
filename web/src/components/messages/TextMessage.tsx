import React, { useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Tag, Space, Tooltip, Button, message as antdMessage } from "antd";
import { CopyOutlined, FileWordOutlined } from "@ant-design/icons";
import type { Message } from "../../types/messages";

type Props = {
  message: Extract<Message, { type: "text" }>;
  actions?: React.ReactNode;
};

export const TextMessage: React.FC<Props> = ({ message, actions }) => {
  const contentRef = useRef<HTMLDivElement>(null);

  const roleColor =
    message.role === "user" ? "blue" : message.role === "system" ? "purple" : "green";

  const handleCopyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      antdMessage.success("Markdown 已复制");
    } catch (error: unknown) {
      console.error("Markdown 复制失败:", error);
      antdMessage.error("复制失败，请检查浏览器剪贴板权限");
    }
  }, [message.content]);

  const handleCopyWord = useCallback(async () => {
    if (!contentRef.current) {
      antdMessage.warning("内容尚未渲染完成");
      return;
    }

    try {
      const htmlContent = contentRef.current.innerHTML;
      const blobHtml = new Blob([htmlContent], { type: "text/html" });
      const blobText = new Blob([message.content], { type: "text/plain" });

      const clipboardItem = new ClipboardItem({
        "text/html": blobHtml,
        "text/plain": blobText,
      });

      await navigator.clipboard.write([clipboardItem]);
      antdMessage.success("富文本已复制，可直接粘贴到 Word");
    } catch (error: unknown) {
      console.error("Word 富文本复制失败:", error);
      antdMessage.error("复制失败，当前浏览器可能不支持该剪贴板能力");
    }
  }, [message.content]);

  return (
    <div className="message text-message">
      <div className="message-header">
        <Tag color={roleColor}>{message.role.toUpperCase()}</Tag>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {actions && <div className="message-inline-actions">{actions}</div>}

          {!message.streaming && message.role !== "user" && (
            <Space size={4}>
              <Tooltip title="复制为 Markdown">
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={handleCopyMarkdown}
                />
              </Tooltip>
              <Tooltip title="复制为 Word（保留排版）">
                <Button
                  size="small"
                  type="text"
                  icon={<FileWordOutlined />}
                  onClick={handleCopyWord}
                />
              </Tooltip>
            </Space>
          )}
        </div>

        {message.streaming && <span className="streaming-dot">···</span>}
      </div>

      <div ref={contentRef} className={`markdown-body ${message.streaming ? "streaming" : ""}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
};
