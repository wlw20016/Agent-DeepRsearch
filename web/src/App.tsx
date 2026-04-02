import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Layout, Typography, message as antdMessage, Badge, Space, Tag } from "antd";
import { v4 as uuid } from "uuid";
import { ChatInput } from "./components/ChatInput";
import { MessageRenderer } from "./components/MessageRenderer";
import { SessionList } from "./components/SessionList";
import type { ConnectionStatus, Message, Session } from "./types/messages";
import { useAgentStream } from "./hooks/useAgentStream";
import "./App.css";
import { TimelineNav } from "../src/components/messages/TimelineNav";

const { Header, Content, Sider } = Layout;

const STORAGE_KEY = "research-assistant-sessions";
const LABEL_NEW_SESSION = "\u65b0\u4f1a\u8bdd";
const LABEL_GENERATING = "\u751f\u6210\u4e2d";
const LABEL_RECONNECTING = "\u91cd\u8fde\u4e2d";
const LABEL_ERROR = "\u8fde\u63a5\u5f02\u5e38";
const LABEL_IDLE = "\u7a7a\u95f2";
const LABEL_PAUSED = "\u5df2\u6682\u505c";
const LABEL_HEADER = "AI深度研究助手";
const FOOTER_HINT =
  "\u652f\u6301 Markdown\uff0c\u65ad\u7ebf\u81ea\u52a8\u91cd\u8fde\uff0c\u5de5\u5177\u8c03\u7528\u53ef\u6298\u53e0\u67e5\u770b\u3002";
const SCROLL_BOTTOM_THRESHOLD = 16;
const SCROLL_THROTTLE_MS = 80;

function throttle<T extends (...args: unknown[]) => void>(fn: T, wait: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  return function throttled(this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  } as T;
}

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: Session[] = JSON.parse(raw);
      // 读取历史消息时，确保不再使用流式打字效果
      return parsed.map((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.type === "text" ? { ...m, streaming: false } : m
        ),
      }));
    }
  } catch {
    /* ignore */
  }
  return [
    {
      id: uuid(),
      title: LABEL_NEW_SESSION,
      createdAt: Date.now(),
      messages: [],
    },
  ];
}

export default function App() {
  // 存入loadSessions函数，只有首次渲染时被调用。如果传入的是loadSessions()，那么每次被渲染后，就会重新触发
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState<string>(sessions[0]?.id ?? "");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [hasOverflow, setHasOverflow] = useState(false);
  const autoScrollRef = useRef(true);
  //
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId]
  );

  //自动存储 逻辑：sessions会话内容变化，就执行保存一下
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  //自动滚动
  useEffect(() => {
    autoScrollRef.current = autoScrollEnabled;
  }, [autoScrollEnabled]);

  //滚动到底部
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setIsAtBottom(true);
  }, []);

  //更新滚动指标
  const updateScrollMetrics = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return false;
    const distanceToBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    const atBottom = distanceToBottom <= SCROLL_BOTTOM_THRESHOLD;
    setIsAtBottom(atBottom);
    setHasOverflow(el.scrollHeight > el.clientHeight + 4);
    return atBottom;
  }, []);
  //添加消息 流式消息合并 更新消息
  const appendMessage = (msg: Message) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSession?.id) return s;
        const existingIdx = s.messages.findIndex((m) => m.id === msg.id);
        let newMessages = s.messages.slice();
        if (existingIdx >= 0 && msg.type === "text" && msg.streaming) {
          const existing = newMessages[existingIdx] as Extract<Message, { type: "text" }>;
          newMessages[existingIdx] = {
            ...existing,
            content: existing.content + msg.content,
            streaming: msg.streaming,
          };
        } else if (existingIdx >= 0) {
          newMessages[existingIdx] = msg;
        } else {
          newMessages = [...newMessages, msg];
        }
        return { ...s, messages: newMessages };
      })
    );
  };
  //发送消息
  const updateUserMessage = (text: string) => {
    const userMsg: Message = { id: uuid(), type: "text", role: "user", content: text };
    autoScrollRef.current = true;
    setAutoScrollEnabled(true);
    scrollToBottom("auto");
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession?.id ? { ...s, messages: [...s.messages, userMsg] } : s
      )
    );
    stream.start(text);
  };
  //流式处理 stream : { status, start: openStream, close: closeStream, pause }
  const stream = useAgentStream({
    sessionId: activeSession?.id ?? "default",
    onMessage: appendMessage,
    onDone: () => {
      // 将最后的流式消息标记为已完成，避免历史记录再次打字机渲染
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSession?.id) return s;
          if (!s.messages.length) return s;
          const lastIdx = s.messages.length - 1;
          const last = s.messages[lastIdx];
          if (last.type === "text" && last.streaming) {
            const updated = s.messages.slice();
            updated[lastIdx] = { ...last, streaming: false };
            return { ...s, messages: updated };
          }
          return s;
        })
      );
    },
  });

  const isStreaming = stream.status === "streaming";
  //自动滚动
  useEffect(() => {
    autoScrollRef.current = true;
    // 使用 requestAnimationFrame 延迟 setState 调用，避免同步调用导致的级联渲染
    requestAnimationFrame(() => {
      setAutoScrollEnabled(true);
    });

    requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
  }, [activeSession?.id, scrollToBottom]);

  useEffect(() => {
    updateScrollMetrics();
  }, [activeSession?.messages, updateScrollMetrics]);

  useLayoutEffect(() => {
    if (!autoScrollEnabled) return;
    // 使用 requestAnimationFrame 延迟执行，避免在 effect 中同步调用 setState
    requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
  }, [activeSession?.messages, autoScrollEnabled, scrollToBottom, stream.status]);
  //处理滚动事件
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const handleScroll = throttle(() => {
      const atBottom = updateScrollMetrics();
      autoScrollRef.current = atBottom;
      setAutoScrollEnabled(atBottom);
    }, SCROLL_THROTTLE_MS);
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [updateScrollMetrics]);

  //DOM变化监听
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const mutationObserver = new MutationObserver(() => {
      const shouldStick = autoScrollRef.current;
      updateScrollMetrics();
      if (shouldStick) {
        scrollToBottom("auto");
      }
    });
    mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });
    const resizeObserver = new ResizeObserver(() => {
      updateScrollMetrics();
      if (autoScrollRef.current) {
        scrollToBottom("auto");
      }
    });
    resizeObserver.observe(el);
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [scrollToBottom, updateScrollMetrics]);

  //审批决策
  const onDecision = async (actionId: string, decision: "approve" | "reject") => {
    const res = await fetch(
      `${(import.meta.env.VITE_API_BASE ?? "http://localhost:3001").replace(/\/$/, "")}/api/hil`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, decision }),
      }
    );
    if (!res.ok) antdMessage.error("\u53d1\u9001\u5ba1\u6279\u5931\u8d25");
  };

  const handleResend = (text: string) => updateUserMessage(text);
  const handleRetry = (message: Message) => {
    if (message.type === "text") updateUserMessage(message.content);
  };
  //创建会话
  const createSession = () => {
    const s: Session = {
      id: uuid(),
      title: LABEL_NEW_SESSION,
      createdAt: Date.now(),
      messages: [],
    };
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  };

  const setTitleFromPrompt = (prompt: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession?.id ? { ...s, title: prompt.slice(0, 24) } : s))
    );
  };
  //渲染状态标签
  const renderStatusTag = () => {
    switch (stream.status) {
      case "streaming":
        return (
          <Tag color="green" style={{ marginLeft: 8 }}>
            {LABEL_GENERATING}
          </Tag>
        );
      case "reconnecting":
        return (
          <Tag color="orange" style={{ marginLeft: 8 }}>
            {LABEL_RECONNECTING}
          </Tag>
        );
      case "error":
        return (
          <Tag color="red" style={{ marginLeft: 8 }}>
            {LABEL_ERROR}
          </Tag>
        );
      case "paused":
        return (
          <Tag color="blue" style={{ marginLeft: 8 }}>
            {LABEL_PAUSED}
          </Tag>
        );
      default:
        return null;
    }
  };

  const badgeTextMap: Record<ConnectionStatus, string> = {
    idle: LABEL_IDLE,
    streaming: LABEL_GENERATING,
    reconnecting: LABEL_RECONNECTING,
    error: LABEL_ERROR,
    paused: LABEL_PAUSED,
  };

  const showScrollToBottom = !isAtBottom && (isStreaming || hasOverflow);

  return (
    <Layout className="layout">
      {/* 左侧 会话列表 */}
      <Sider width={260} theme="light" className="sider">
        <SessionList
          sessions={sessions}
          activeId={activeSession?.id ?? ""}
          onCreate={createSession}
          onSelect={(id) => {
            stream.close("idle");
            setActiveId(id);
          }}
        />
      </Sider>

      {/* 中间 */}
      <Layout>
        {/* 头部 */}
        <Header className="header">
          {/* 标题 */}
          <div>
            <Typography.Title level={4} style={{ margin: 0 }} className="brand-title" >
              {LABEL_HEADER}
              {renderStatusTag()}
            </Typography.Title>           
          </div>
          {/* 状态指示器 */}
          <Badge
            status={
              stream.status === "streaming"
                ? "processing"
                : stream.status === "reconnecting"
                ? "warning"
                : stream.status === "error"
                ? "error"
                : "default"
            }
            text={badgeTextMap[stream.status]}
          />
        </Header>
        {/* 内容 */}
        <Content className="content">
          <div className="content-inner">
            {/* 消息容器 */}
            <div className="messages-container">

              {/* 消息列表 
                  拿到当前会话以后，就开始渲染会话中的内容
              */}
              <div className="messages" ref={messagesRef}>
                {activeSession?.messages.map((m) => (
                  <div key={m.id} id={`chat-msg-${m.id}`}>
                    <MessageRenderer
                      message={m}
                      onResend={(text) => {
                        setTitleFromPrompt(text);
                        handleResend(text);
                      }}
                      onRetry={handleRetry}
                      onDecision={onDecision}
                    />
                  </div>
                ))}
              </div>

              {/* 回到底部按钮 */}
              {showScrollToBottom && (
                <button
                  type="button"
                  className="scroll-to-bottom"
                  aria-label="回到底部"
                  onClick={() => {
                    setAutoScrollEnabled(true);
                    scrollToBottom("smooth");
                  }}
                >
                  ↓
                </button>
              )}
            </div>

            {/* 输入栏 */}
            <div className="input-bar">
              <Space orientation="vertical" style={{ width: "100%" }}>
                {/* 输入框 */}
                <ChatInput
                  onSend={(text) => {
                    setTitleFromPrompt(text);
                    updateUserMessage(text);
                  }}
                  isStreaming={stream.status === "streaming"}
                  onPause={stream.pause}
                />
                {/* 底部提示 */}
                <Typography.Text type="secondary">
                  {FOOTER_HINT}
                </Typography.Text>
              </Space>
            </div>
          </div>
        </Content>
      </Layout>


      {/* 右侧 */}
      <Sider 
        width={240} 
        theme="light" 
        style={{ 
          borderLeft: "1px solid #e8e8e8", 
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          height: "100vh" 
        }}
      >
        <TimelineNav messages={activeSession?.messages ?? []} />
      </Sider>
    </Layout>
  );
}
