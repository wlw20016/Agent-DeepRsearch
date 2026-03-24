// import React, { useEffect, useState } from "react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import rehypeHighlight from "rehype-highlight";
// import type { Message } from "../../types/messages";
// import { Tag } from "antd";

// type Props = {
//   message: Extract<Message, { type: "text" }>;
//   actions?: React.ReactNode;
// };

// export const TextMessage: React.FC<Props> = ({ message, actions }) => {
//   const [displayedContent, setDisplayedContent] = useState(
//     message.streaming ? "" : message.content
//   );

//   const roleColor =
//     message.role === "user" ? "blue" : message.role === "system" ? "purple" : "green";

//   // 当新消息到来时重置
//   useEffect(() => {
//     setDisplayedContent(message.streaming ? "" : message.content);
//   }, [message.id, message.streaming, message.content]);

//   // 当流消息到来时渲染打字机效果
//   useEffect(() => {
//     //就是说：这是历史消息，不再需要流式渲染了
//     if (!message.streaming) {
//       setDisplayedContent(message.content);
//       return;
//     }
//     const target = message.content;
//     let i = displayedContent.length;
//     let cancelled = false;

//     const tick = () => {
//       if (cancelled) return;
//       i = Math.min(i + 2, target.length);
//       setDisplayedContent(target.slice(0, i));
//       if (i < target.length) {
//         setTimeout(tick, 14);
//       }
//     };

//     if (i < target.length) tick();

//     return () => {
//       cancelled = true;
//     };
//   }, [message.content, message.streaming]);//消息内容变了，流式状态变了

//   return (
//     <div className="message text-message">
//       <div className="message-header">
//         <Tag color={roleColor}>{message.role.toUpperCase()}</Tag>
//         {actions && <div className="message-inline-actions">{actions}</div>}
//         {message.streaming && <span className="streaming-dot">···</span>}
//       </div>
//       <div className={`markdown-body ${message.streaming ? "streaming" : ""}`}>
//         <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
//           {displayedContent}
//         </ReactMarkdown>
//       </div>
//     </div>
//   );
// };

import React, { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
// 注意：将 antd 的 message 重命名为 antdMessage，防止与 props 中的 message 变量名冲突
import { Tag, Space, Tooltip, Button, message as antdMessage } from "antd";
import { CopyOutlined, FileWordOutlined } from "@ant-design/icons";
import type { Message } from "../../types/messages";

type Props = {
  message: Extract<Message, { type: "text" }>;
  actions?: React.ReactNode;
};

export const TextMessage: React.FC<Props> = ({ message, actions }) => {
  // 1. 保留原有：流式文本渲染状态
  const [displayedContent, setDisplayedContent] = useState(
    message.streaming ? "" : message.content
  );

  // 2. 新增：捕获 Markdown 渲染后的真实 HTML DOM
  const contentRef = useRef<HTMLDivElement>(null);

  const roleColor =
    message.role === "user" ? "blue" : message.role === "system" ? "purple" : "green";

  // --- 原有打字机 Effect 逻辑完全保留 ---
  useEffect(() => {
    // 使用 requestAnimationFrame 或 setTimeout 延迟 setState 调用，避免同步调用导致的级联渲染
    const timeoutId = setTimeout(() => {
      setDisplayedContent(message.streaming ? "" : message.content);
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [message.id, message.streaming, message.content]);

  useEffect(() => {
    if (!message.streaming) {
      // 使用 requestAnimationFrame 延迟 setState 调用，避免同步调用导致的级联渲染
      requestAnimationFrame(() => {
        setDisplayedContent(message.content);
      });
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
  }, [message.content, message.streaming]);
  // ------------------------------------

  // 3. 新增：纯文本 Markdown 复制逻辑
  const handleCopyMarkdown = useCallback(async () => {
    try {
      // 严谨点：必须复制 message.content (全量数据)，而不是 displayedContent (可能处于打字机截断状态)
      await navigator.clipboard.writeText(message.content);
      antdMessage.success("Markdown 源码已复制");
    } catch (error: unknown) {
      console.error("Markdown 复制失败:", error);
      antdMessage.error("复制失败，请检查浏览器剪贴板权限");
    }
  }, [message.content]);

  // 4. 新增：富文本 Word 复制逻辑
  const handleCopyWord = useCallback(async () => {
    if (!contentRef.current) {
      antdMessage.warning("内容尚未渲染完毕");
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
      antdMessage.success("富文本已复制，可直接粘贴至 Word");
    } catch (error: unknown) {
      console.error("Word 富文本复制失败:", error);
      antdMessage.error("复制失败，您的浏览器可能不支持高级剪贴板操作");
    }
  }, [message.content]);

  return (
    <div className="message text-message">
      <div className="message-header">
        <Tag color={roleColor}>{message.role.toUpperCase()}</Tag>
        
        {/* 交互视图层融合：将外部传入的 actions 与新增的复制按钮组合并排 */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {actions && <div className="message-inline-actions">{actions}</div>}
          
          {/* 严谨的条件渲染：
            1. !message.streaming -> 确保模型完全输出完毕后再显示复制按钮，防止打字机渲染时按钮闪烁误触。
            2. message.role !== "user" -> 因为 MessageRenderer.tsx 已经给 user 发送了带有默认“复制”按钮的 actions，这里过滤掉以防止用户消息气泡出现 3 个复制按钮。
          */}
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
              <Tooltip title="复制为 Word (保留排版)">
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
      
      {/* 5. DOM 绑定：将 ref 精准挂载到 Markdown 容器上 */}
      <div 
        ref={contentRef} 
        className={`markdown-body ${message.streaming ? "streaming" : ""}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {displayedContent}
        </ReactMarkdown>
      </div>
    </div>
  );
};