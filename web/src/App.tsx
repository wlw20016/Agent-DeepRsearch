import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Layout, Typography, message as antdMessage, Badge, Space, Tag } from "antd";
import { v4 as uuid } from "uuid";
import { ChatInput } from "./components/ChatInput";
import { MessageRenderer } from "./components/MessageRenderer";
import { SessionList } from "./components/SessionList";
import type { ConnectionStatus, Message, Session } from "./types/messages";
import { useAgentStream } from "./hooks/useAgentStream";
import { TimelineNav } from "./components/messages/TimelineNav";
import "./App.css";

const { Header, Content, Sider } = Layout;

const STORAGE_KEY = "research-assistant-sessions";
const LABEL_NEW_SESSION = "新会话";
const LABEL_GENERATING = "生成中";
const LABEL_RECONNECTING = "重连中";
const LABEL_ERROR = "连接异常";
const LABEL_IDLE = "空闲";
const LABEL_PAUSED = "已暂停";
const LABEL_HEADER = "AI深度研究助手";
const FOOTER_HINT = "支持 Markdown，断线自动重连，工具调用可折叠查看。";
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
      return;
    }

    if (!timer) {
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
      return parsed.map((session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.type === "text" ? { ...message, streaming: false } : message
        ),
      }));
    }
  } catch {
    /* ignore invalid localStorage */
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
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState<string>(sessions[0]?.id ?? "");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [hasOverflow, setHasOverflow] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? sessions[0],
    [sessions, activeId]
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    autoScrollRef.current = autoScrollEnabled;
  }, [autoScrollEnabled]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = messagesRef.current;
    if (!element) return;

    element.scrollTo({ top: element.scrollHeight, behavior });
    setIsAtBottom(true);
  }, []);

  const updateScrollMetrics = useCallback(() => {
    const element = messagesRef.current;
    if (!element) return false;

    const distanceToBottom = element.scrollHeight - element.clientHeight - element.scrollTop;
    const atBottom = distanceToBottom <= SCROLL_BOTTOM_THRESHOLD;
    setIsAtBottom(atBottom);
    setHasOverflow(element.scrollHeight > element.clientHeight + 4);
    return atBottom;
  }, []);

  const appendMessage = useCallback(
    (incoming: Message) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== activeSession?.id) return session;

          const existingIndex = session.messages.findIndex((message) => message.id === incoming.id);
          if (existingIndex < 0) {
            return { ...session, messages: [...session.messages, incoming] };
          }

          const nextMessages = session.messages.slice();
          const existing = nextMessages[existingIndex];

          if (existing.type === "text" && incoming.type === "text") {
            nextMessages[existingIndex] = incoming.streaming
              ? {
                  ...existing,
                  content: existing.content + incoming.content,
                  streaming: true,
                }
              : {
                  ...existing,
                  ...incoming,
                  content: incoming.content || existing.content,
                  streaming: false,
                };
          } else {
            nextMessages[existingIndex] = incoming;
          }

          return { ...session, messages: nextMessages };
        })
      );
    },
    [activeSession?.id]
  );

  const stream = useAgentStream({
    sessionId: activeSession?.id ?? "default",
    onMessage: appendMessage,
    onDone: () => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== activeSession?.id) return session;

          return {
            ...session,
            messages: session.messages.map((message) =>
              message.type === "text" && message.streaming
                ? { ...message, streaming: false }
                : message
            ),
          };
        })
      );
    },
  });

  const updateUserMessage = (text: string) => {
    const userMessage: Message = { id: uuid(), type: "text", role: "user", content: text };
    autoScrollRef.current = true;
    setAutoScrollEnabled(true);
    scrollToBottom("auto");

    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSession?.id
          ? { ...session, messages: [...session.messages, userMessage] }
          : session
      )
    );

    stream.start(text);
  };

  const isStreaming = stream.status === "streaming";

  useEffect(() => {
    autoScrollRef.current = true;
    requestAnimationFrame(() => setAutoScrollEnabled(true));
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [activeSession?.id, scrollToBottom]);

  useEffect(() => {
    updateScrollMetrics();
  }, [activeSession?.messages, updateScrollMetrics]);

  useLayoutEffect(() => {
    if (!autoScrollEnabled) return;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [activeSession?.messages, autoScrollEnabled, scrollToBottom, stream.status]);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;

    const handleScroll = throttle(() => {
      const atBottom = updateScrollMetrics();
      autoScrollRef.current = atBottom;
      setAutoScrollEnabled(atBottom);
    }, SCROLL_THROTTLE_MS);

    element.addEventListener("scroll", handleScroll);
    return () => element.removeEventListener("scroll", handleScroll);
  }, [updateScrollMetrics]);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;

    const mutationObserver = new MutationObserver(() => {
      const shouldStick = autoScrollRef.current;
      updateScrollMetrics();
      if (shouldStick) {
        scrollToBottom("auto");
      }
    });

    mutationObserver.observe(element, { childList: true, subtree: true, characterData: true });

    const resizeObserver = new ResizeObserver(() => {
      updateScrollMetrics();
      if (autoScrollRef.current) {
        scrollToBottom("auto");
      }
    });

    resizeObserver.observe(element);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [scrollToBottom, updateScrollMetrics]);

  const onDecision = async (actionId: string, decision: "approve" | "reject") => {
    const response = await fetch(
      `${(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "")}/api/hil`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, decision }),
      }
    );

    if (!response.ok) {
      antdMessage.error("发送审批失败");
    }
  };

  const handleResend = (text: string) => updateUserMessage(text);
  const handleRetry = (message: Message) => {
    if (message.type === "text") {
      updateUserMessage(message.content);
    }
  };

  const createSession = () => {
    const session: Session = {
      id: uuid(),
      title: LABEL_NEW_SESSION,
      createdAt: Date.now(),
      messages: [],
    };

    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
  };

  const setTitleFromPrompt = (prompt: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSession?.id
          ? { ...session, title: prompt.slice(0, 24) || LABEL_NEW_SESSION }
          : session
      )
    );
  };

  const renderStatusTag = () => {
    switch (stream.status) {
      case "streaming":
        return <Tag color="green" style={{ marginLeft: 8 }}>{LABEL_GENERATING}</Tag>;
      case "reconnecting":
        return <Tag color="orange" style={{ marginLeft: 8 }}>{LABEL_RECONNECTING}</Tag>;
      case "error":
        return <Tag color="red" style={{ marginLeft: 8 }}>{LABEL_ERROR}</Tag>;
      case "paused":
        return <Tag color="blue" style={{ marginLeft: 8 }}>{LABEL_PAUSED}</Tag>;
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

      <Layout>
        <Header className="header">
          <div>
            <Typography.Title level={4} style={{ margin: 0 }} className="brand-title">
              {LABEL_HEADER}
              {renderStatusTag()}
            </Typography.Title>
          </div>
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

        <Content className="content">
          <div className="content-inner">
            <div className="messages-container">
              <div className="messages" ref={messagesRef}>
                {activeSession?.messages.map((message) => (
                  <div key={message.id} id={`chat-msg-${message.id}`}>
                    <MessageRenderer
                      message={message}
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

            <div className="input-bar">
              <Space orientation="vertical" style={{ width: "100%" }}>
                <ChatInput
                  onSend={(text) => {
                    setTitleFromPrompt(text);
                    updateUserMessage(text);
                  }}
                  isStreaming={stream.status === "streaming"}
                  onPause={stream.pause}
                />
                <Typography.Text type="secondary">{FOOTER_HINT}</Typography.Text>
              </Space>
            </div>
          </div>
        </Content>
      </Layout>

      <Sider
        width={240}
        theme="light"
        style={{
          borderLeft: "1px solid #e8e8e8",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
        }}
      >
        <TimelineNav messages={activeSession?.messages ?? []} />
      </Sider>
    </Layout>
  );
}
