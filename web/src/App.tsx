import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge, Layout, Space, Tag, Typography, message as antdMessage } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { v4 as uuid } from "uuid";
import { ChatInput } from "./components/ChatInput";
import {
  KnowledgePanel,
  type KnowledgeDetail,
  type KnowledgeItem,
} from "./components/KnowledgePanel";
import { MessageListItem } from "./components/MessageListItem";
import { SessionList } from "./components/SessionList";
import { TimelineNav } from "./components/messages/TimelineNav";
import { useAgentStream } from "./hooks/useAgentStream";
import {
  createRemoteSession,
  fetchSessionMessages,
  fetchSessions,
  saveRemoteMessage,
  updateRemoteSessionTitle,
} from "./api/sessions";
import { loadCachedSessions, saveCachedSessions } from "./storage/sessionCache";
import type { ConnectionStatus, Message, Session } from "./types/messages";
import "./App.css";

const { Header, Content, Sider } = Layout;

const STORAGE_KEY = "research-assistant-sessions";
const LABEL_NEW_SESSION = "新会话";
const LABEL_GENERATING = "生成中";
const LABEL_RECONNECTING = "重连中";
const LABEL_ERROR = "连接异常";
const LABEL_IDLE = "空闲";
const LABEL_PAUSED = "已暂停";
const LABEL_HEADER = "AI 深度研究助手";
const FOOTER_HINT = "支持 Markdown、知识库上传、搜索、预览、断线重连和工具调用可视化。";
const SCROLL_BOTTOM_THRESHOLD = 16;
const SCROLL_THROTTLE_MS = 80;

type UploadResponse =
  | { ok: true; documentCount: number; chunkCount: number; files: string[] }
  | { error?: string; unsupported?: string[] };

type KnowledgeListResponse = { ok: true; items: KnowledgeItem[] } | { error?: string };

type KnowledgeDetailResponse = { ok: true; item: KnowledgeDetail } | { error?: string };

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
      updatedAt: Date.now(),
      messages: [],
    },
  ];
}

function mergeSessions(localSessions: Session[], remoteSessions: Session[]): Session[] {
  const localById = new Map(localSessions.map((session) => [session.id, session]));
  const remoteById = new Map(remoteSessions.map((session) => [session.id, session]));
  const ids = new Set([...remoteById.keys(), ...localById.keys()]);

  return Array.from(ids)
    .map((id) => {
      const local = localById.get(id);
      const remote = remoteById.get(id);
      if (!local) return remote;
      if (!remote) return local;

      return {
        ...remote,
        messages: local.messages.length ? local.messages : remote.messages,
      };
    })
    .filter((session): session is Session => Boolean(session))
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

function updateMessageSyncStatus(
  sessions: Session[],
  sessionId: string,
  messageId: string,
  syncStatus: Message["syncStatus"]
) {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;

    return {
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId ? { ...message, syncStatus } : message
      ),
    };
  });
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState<string>(sessions[0]?.id ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeBusyPath, setKnowledgeBusyPath] = useState<string | null>(null);
  const [knowledgeRefreshingAll, setKnowledgeRefreshingAll] = useState(false);
  const [knowledgePreviewPath, setKnowledgePreviewPath] = useState<string | null>(null);
  const [knowledgePreviewLoading, setKnowledgePreviewLoading] = useState(false);
  const [knowledgePreviewItem, setKnowledgePreviewItem] = useState<KnowledgeDetail | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const sessionsRef = useRef<Session[]>(sessions);
  const autoScrollRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [hasOverflow, setHasOverflow] = useState(false);

  const apiBase = `${(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "")}`;

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? sessions[0],
    [sessions, activeId]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void saveCachedSessions(sessions).catch((error: unknown) => {
        console.error("Failed to save IndexedDB session cache", error);
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [sessions]);

  useEffect(() => {
    let cancelled = false;

    loadCachedSessions()
      .then((cachedSessions) => {
        if (cancelled || !cachedSessions.length) return;
        setSessions((prev) => {
          const merged = mergeSessions(prev, cachedSessions);
          setActiveId((current) =>
            merged.some((session) => session.id === current) ? current : merged[0].id
          );
          return merged;
        });
      })
      .catch((error: unknown) => {
        console.error("Failed to load IndexedDB session cache", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchSessions()
      .then((remoteSessions) => {
        if (cancelled) return;

        setSessions((prev) => {
          const merged = mergeSessions(prev, remoteSessions);
          if (!merged.length) return prev;
          setActiveId((current) =>
            merged.some((session) => session.id === current) ? current : merged[0].id
          );
          return merged;
        });
      })
      .catch((error: unknown) => {
        console.error("Failed to sync sessions", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeSession?.id) return;
    if (activeSession.messages.length > 0) return;

    let cancelled = false;

    fetchSessionMessages(activeSession.id)
      .then((messages) => {
        if (cancelled || !messages.length) return;
        setSessions((prev) =>
          prev.map((session) =>
            session.id === activeSession.id ? { ...session, messages } : session
          )
        );
      })
      .catch((error: unknown) => {
        console.error("Failed to sync session messages", error);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, activeSession?.messages.length]);

  useEffect(() => {
    autoScrollRef.current = autoScrollEnabled;
  }, [autoScrollEnabled]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    let retrying = false;

    const retryFailedMessages = async () => {
      if (retrying) return;
      retrying = true;

      try {
        for (const session of sessionsRef.current) {
          for (const item of session.messages) {
            if (item.role !== "user" && item.role !== "system") continue;
            if (item.syncStatus !== "failed") continue;

            try {
              await saveRemoteMessage(session.id, { ...item, syncStatus: "pending" });
              setSessions((prev) => updateMessageSyncStatus(prev, session.id, item.id, "synced"));
            } catch (error: unknown) {
              console.error("Failed to retry message sync", error);
            }
          }
        }
      } finally {
        retrying = false;
      }
    };

    window.addEventListener("online", retryFailedMessages);
    const timer = window.setInterval(retryFailedMessages, 15_000);
    void retryFailedMessages();

    return () => {
      window.removeEventListener("online", retryFailedMessages);
      window.clearInterval(timer);
    };
  }, []);

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
            return { ...session, updatedAt: Date.now(), messages: [...session.messages, incoming] };
          }

          const nextMessages = session.messages.slice();
          const existing = nextMessages[existingIndex];

          if (existing.type === "text" && incoming.type === "text") {
            nextMessages[existingIndex] = incoming.streaming
              ? { ...existing, content: existing.content + incoming.content, streaming: true }
              : { ...existing, ...incoming, content: incoming.content || existing.content, streaming: false };
          } else {
            nextMessages[existingIndex] = incoming;
          }

          return { ...session, updatedAt: Date.now(), messages: nextMessages };
        })
      );
    },
    [activeSession?.id]
  );

  const {
    status: streamStatus,
    start: startStream,
    close: closeStream,
    pause: pauseStream,
  } = useAgentStream({
    sessionId: activeSession?.id ?? "default",
    onMessage: appendMessage,
    onDone: () => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== activeSession?.id) return session;

          return {
            ...session,
            messages: session.messages.map((message) =>
              message.type === "text" && message.streaming ? { ...message, streaming: false } : message
            ),
          };
        })
      );
    },
  });

  const appendSystemMessage = useCallback(
    (content: string) => {
      const systemMessage: Message = {
        id: uuid(),
        type: "text",
        role: "system",
        content,
        syncStatus: "pending",
      };
      const sessionId = activeSession?.id;
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, updatedAt: Date.now(), messages: [...session.messages, systemMessage] }
            : session
        )
      );

      if (sessionId) {
        void saveRemoteMessage(sessionId, systemMessage)
          .then(() => {
            setSessions((prev) =>
              updateMessageSyncStatus(prev, sessionId, systemMessage.id, "synced")
            );
          })
          .catch((error: unknown) => {
            console.error("Failed to save system message", error);
            setSessions((prev) =>
              updateMessageSyncStatus(prev, sessionId, systemMessage.id, "failed")
            );
          });
      }
    },
    [activeSession?.id]
  );

  const updateUserMessage = useCallback(
    (text: string) => {
      const userMessage: Message = {
        id: uuid(),
        type: "text",
        role: "user",
        content: text,
        syncStatus: "pending",
      };
      const sessionId = activeSession?.id;
      autoScrollRef.current = true;
      setAutoScrollEnabled(true);
      scrollToBottom("auto");

      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, updatedAt: Date.now(), messages: [...session.messages, userMessage] }
            : session
        )
      );

      if (sessionId) {
        void saveRemoteMessage(sessionId, userMessage)
          .then(() => {
            setSessions((prev) =>
              updateMessageSyncStatus(prev, sessionId, userMessage.id, "synced")
            );
          })
          .catch((error: unknown) => {
            console.error("Failed to save user message", error);
            setSessions((prev) =>
              updateMessageSyncStatus(prev, sessionId, userMessage.id, "failed")
            );
          });
      }

      startStream(text);
    },
    [activeSession?.id, scrollToBottom, startStream]
  );

  const loadKnowledgeItems = useCallback(async () => {
    setKnowledgeLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/knowledge`);
      const data = (await response.json()) as KnowledgeListResponse;
      if (!response.ok || !("ok" in data && data.ok)) {
        throw new Error(("error" in data && data.error) || "加载知识库列表失败");
      }

      setKnowledgeItems(data.items);
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : "加载知识库列表失败";
      antdMessage.error(messageText);
    } finally {
      setKnowledgeLoading(false);
    }
  }, [apiBase]);

  const loadKnowledgePreview = useCallback(
    async (relativePath: string) => {
      setKnowledgePreviewPath(relativePath);
      setKnowledgePreviewLoading(true);
      try {
        const response = await fetch(
          `${apiBase}/api/knowledge/detail?path=${encodeURIComponent(relativePath)}`
        );
        const data = (await response.json()) as KnowledgeDetailResponse;
        if (!response.ok || !("ok" in data && data.ok)) {
          throw new Error(("error" in data && data.error) || "加载文档预览失败");
        }

        setKnowledgePreviewItem(data.item);
      } catch (error: unknown) {
        const messageText = error instanceof Error ? error.message : "加载文档预览失败";
        antdMessage.error(messageText);
      } finally {
        setKnowledgePreviewLoading(false);
      }
    },
    [apiBase]
  );

  const handleUpload = useCallback(
    async (files: FileList) => {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));

      setIsUploading(true);
      try {
        const response = await fetch(`${apiBase}/api/knowledge/upload`, {
          method: "POST",
          body: formData,
        });

        const data = (await response.json()) as UploadResponse;
        if (!response.ok || !("ok" in data && data.ok)) {
          const errorPayload = "error" in data ? data : undefined;
          const unsupportedHint = errorPayload?.unsupported?.length
            ? `，不支持：${errorPayload.unsupported.join("、")}`
            : "";
          throw new Error(`${errorPayload?.error ?? "上传失败"}${unsupportedHint}`);
        }

        antdMessage.success(`已入库 ${data.documentCount} 个文档，生成 ${data.chunkCount} 个切片`);
        appendSystemMessage(
          `知识库入库完成：${data.files.join("、")}。\n已处理 ${data.documentCount} 个文档，生成 ${data.chunkCount} 个切片。`
        );
        await loadKnowledgeItems();
        if (data.files[0]) {
          await loadKnowledgePreview(data.files[0]);
        }
      } catch (error: unknown) {
        const messageText = error instanceof Error ? error.message : "上传失败";
        antdMessage.error(messageText);
        appendSystemMessage(`知识库入库失败：${messageText}`);
      } finally {
        setIsUploading(false);
      }
    },
    [apiBase, appendSystemMessage, loadKnowledgeItems, loadKnowledgePreview]
  );

  const handleDeleteKnowledge = useCallback(
    async (relativePath: string) => {
      setKnowledgeBusyPath(relativePath);
      try {
        const response = await fetch(
          `${apiBase}/api/knowledge?path=${encodeURIComponent(relativePath)}`,
          { method: "DELETE" }
        );
        const data = (await response.json()) as { ok?: boolean; deleted?: string; error?: string };
        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "删除知识库文档失败");
        }

        antdMessage.success(`已删除 ${relativePath}`);
        appendSystemMessage(`知识库文档已删除：${relativePath}`);
        if (knowledgePreviewPath === relativePath) {
          setKnowledgePreviewItem(null);
          setKnowledgePreviewPath(null);
        }
        await loadKnowledgeItems();
      } catch (error: unknown) {
        const messageText = error instanceof Error ? error.message : "删除知识库文档失败";
        antdMessage.error(messageText);
      } finally {
        setKnowledgeBusyPath(null);
      }
    },
    [apiBase, appendSystemMessage, knowledgePreviewPath, loadKnowledgeItems]
  );

  const handleReingestKnowledge = useCallback(
    async (relativePath?: string) => {
      if (relativePath) {
        setKnowledgeBusyPath(relativePath);
      } else {
        setKnowledgeRefreshingAll(true);
      }

      try {
        const response = await fetch(`${apiBase}/api/knowledge/reingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(relativePath ? { path: relativePath } : {}),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          documentCount?: number;
          chunkCount?: number;
          error?: string;
        };

        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "重建知识库失败");
        }

        const scopeLabel = relativePath || "全部文档";
        antdMessage.success(`已重建 ${scopeLabel}`);
        appendSystemMessage(
          `知识库重建完成：${scopeLabel}。处理 ${data.documentCount ?? 0} 个文档，生成 ${
            data.chunkCount ?? 0
          } 个切片。`
        );
        await loadKnowledgeItems();
        if (relativePath) {
          await loadKnowledgePreview(relativePath);
        }
      } catch (error: unknown) {
        const messageText = error instanceof Error ? error.message : "重建知识库失败";
        antdMessage.error(messageText);
      } finally {
        if (relativePath) {
          setKnowledgeBusyPath(null);
        } else {
          setKnowledgeRefreshingAll(false);
        }
      }
    },
    [apiBase, appendSystemMessage, loadKnowledgeItems, loadKnowledgePreview]
  );

  const isStreaming = streamStatus === "streaming";

  useEffect(() => {
    autoScrollRef.current = true;
    requestAnimationFrame(() => setAutoScrollEnabled(true));
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [activeSession?.id, scrollToBottom]);

  useEffect(() => {
    void loadKnowledgeItems();
  }, [loadKnowledgeItems]);

  useEffect(() => {
    updateScrollMetrics();
  }, [activeSession?.messages, updateScrollMetrics]);

  useLayoutEffect(() => {
    if (!autoScrollEnabled) return;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [activeSession?.messages, autoScrollEnabled, scrollToBottom, streamStatus]);

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

  const onDecision = useCallback(async (actionId: string, decision: "approve" | "reject") => {
    const response = await fetch(`${apiBase}/api/hil`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId, decision }),
    });

    if (!response.ok) {
      antdMessage.error("发送审批失败");
    }
  }, [apiBase]);

  const handleResend = useCallback((text: string) => updateUserMessage(text), [updateUserMessage]);
  const handleRetry = useCallback((message: Message) => {
    if (message.type === "text") {
      updateUserMessage(message.content);
    }
  }, [updateUserMessage]);

  const createSession = () => {
    const now = Date.now();
    const session: Session = {
      id: uuid(),
      title: LABEL_NEW_SESSION,
      createdAt: now,
      updatedAt: now,
      syncStatus: "pending",
      messages: [],
    };

    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    void createRemoteSession(session)
      .then((remoteSession) => {
        setSessions((prev) =>
          prev.map((item) =>
            item.id === session.id ? { ...item, ...remoteSession, syncStatus: "synced" } : item
          )
        );
      })
      .catch((error: unknown) => {
        console.error("Failed to create remote session", error);
        setSessions((prev) =>
          prev.map((item) => (item.id === session.id ? { ...item, syncStatus: "failed" } : item))
        );
      });
  };

  const closeSession = useCallback(
    (id: string) => {
      if (id === activeSession?.id) {
        closeStream("idle");
      }

      setSessions((prev) => {
        const nextSessions = prev.filter((session) => session.id !== id);

        if (!nextSessions.length) {
          const session: Session = {
            id: uuid(),
            title: LABEL_NEW_SESSION,
            createdAt: Date.now(),
            messages: [],
          };
          setActiveId(session.id);
          return [session];
        }

        if (id === activeSession?.id) {
          setActiveId(nextSessions[0].id);
        }

        return nextSessions;
      });
    },
    [activeSession?.id, closeStream]
  );

  const setTitleFromPrompt = useCallback((prompt: string) => {
    const sessionId = activeSession?.id;
    const title = prompt.slice(0, 24) || LABEL_NEW_SESSION;
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? { ...session, title, updatedAt: Date.now(), syncStatus: "pending" }
          : session
      )
    );

    if (sessionId) {
      void updateRemoteSessionTitle(sessionId, title)
        .then((remoteSession) => {
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? { ...session, ...remoteSession, syncStatus: "synced" }
                : session
            )
          );
        })
        .catch((error: unknown) => {
          console.error("Failed to update remote session title", error);
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId ? { ...session, syncStatus: "failed" } : session
            )
          );
        });
    }
  }, [activeSession?.id]);

  const handleMessageResend = useCallback(
    (text: string) => {
      setTitleFromPrompt(text);
      handleResend(text);
    },
    [handleResend, setTitleFromPrompt]
  );

  const renderStatusTag = () => {
    switch (streamStatus) {
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
            closeStream("idle");
            setActiveId(id);
          }}
          onClose={closeSession}
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
              streamStatus === "streaming"
                ? "processing"
                : streamStatus === "reconnecting"
                ? "warning"
                : streamStatus === "error"
                ? "error"
                : "default"
            }
            text={badgeTextMap[streamStatus]}
          />
        </Header>

        <Content className="content">
          <div className="content-inner">
            <div className="messages-container">
              <div className="messages" ref={messagesRef}>
                {/* 渲染消息列表的时候，把对应会话的不同消息，放到 MessageListItem中 
                    之前接到的消息，消息id不变，消息内容message不变，
                    三个处理的函数用useCallback包装过也不会变。

                    MessageListItem使用React memo包装，那他就不会被渲染到。

                    只有正在打印内容的列表项，内容才会不断改变，从而在渲染时执行，将content中的内容增量做更新
                */}
                {activeSession?.messages.map((message) => (
                  <MessageListItem
                    key={message.id}
                    message={message}
                    onResend={handleMessageResend}
                    onRetry={handleRetry}
                    onDecision={onDecision}
                  />
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
                  <DownOutlined />
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
                  onUpload={handleUpload}
                  isStreaming={streamStatus === "streaming"}
                  isUploading={isUploading}
                  onPause={pauseStream}
                />
                <Typography.Text type="secondary">{FOOTER_HINT}</Typography.Text>
              </Space>
            </div>
          </div>
        </Content>
      </Layout>

      <Sider width={320} theme="light" className="right-sider">
        <KnowledgePanel
          items={knowledgeItems}
          loading={knowledgeLoading}
          refreshingAll={knowledgeRefreshingAll}
          busyPath={knowledgeBusyPath}
          previewPath={knowledgePreviewPath}
          previewLoading={knowledgePreviewLoading}
          previewItem={knowledgePreviewItem}
          onRefresh={() => void loadKnowledgeItems()}
          onReingestAll={() => void handleReingestKnowledge()}
          onReingestOne={(path) => void handleReingestKnowledge(path)}
          onDeleteOne={(path) => void handleDeleteKnowledge(path)}
          onPreview={(path) => void loadKnowledgePreview(path)}
        />
        <TimelineNav messages={activeSession?.messages ?? []} />
      </Sider>
    </Layout>
  );
}
