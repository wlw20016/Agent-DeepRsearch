import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { ConnectionStatus, Message } from "../types/messages";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const STREAM_FLUSH_MS = 40;
const RUN_STORAGE_PREFIX = "research-assistant-active-run:";

type StoredRun = {
  runId: string;
  prompt: string;
  lastSeq: number;
  status: "running" | "completed" | "failed" | "cancelled";
};

type Props = {
  sessionId: string;
  onMessage: (message: Message) => void;
  onDone?: () => void;
};

export function useAgentStream({ sessionId, onMessage, onDone }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [retry, setRetry] = useState(0);
  const [currentPrompt, setCurrentPrompt] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const onMessageRef = useRef(onMessage);
  const onDoneRef = useRef(onDone);
  const runIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  const activePromptRef = useRef<string | null>(null);
  const restoredSessionRef = useRef<string | null>(null);
  const pendingTextRef = useRef(new Map<string, Extract<Message, { type: "text" }>>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runStorageKey = `${RUN_STORAGE_PREFIX}${sessionId}`;

  const saveStoredRun = useCallback(
    (patch: Partial<StoredRun> = {}) => {
      if (!runIdRef.current || !activePromptRef.current) return;

      const stored: StoredRun = {
        runId: runIdRef.current,
        prompt: activePromptRef.current,
        lastSeq: lastSeqRef.current,
        status: "running",
        ...patch,
      };

      localStorage.setItem(runStorageKey, JSON.stringify(stored));
    },
    [runStorageKey]
  );

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const flushPendingText = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const pending = pendingTextRef.current;
    if (!pending.size) return;

    const messages = Array.from(pending.values());
    pending.clear();
    messages.forEach((message) => onMessageRef.current(message));
  }, []);

  const queueMessage = useCallback(
    (message: Message) => {
      if (message.type !== "text" || !message.streaming) {
        flushPendingText();
        onMessageRef.current(message);
        return;
      }

      const pending = pendingTextRef.current;
      const existing = pending.get(message.id);
      pending.set(
        message.id,
        existing
          ? { ...existing, content: existing.content + message.content, streaming: true }
          : message
      );

      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flushPendingText, STREAM_FLUSH_MS);
      }
    },
    [flushPendingText]
  );

  const closeStream = useCallback(
    (nextStatus?: ConnectionStatus) => {
      flushPendingText();
      if (ctrlRef.current) {
        ctrlRef.current.abort();
        ctrlRef.current = null;
      }
      if (nextStatus) setStatus(nextStatus);
    },
    [flushPendingText]
  );

  const pause = useCallback(() => {
    closeStream("paused");
    setRetry(0);
  }, [closeStream]);

  const openStream = useCallback(
    (prompt: string, isReconnect = false) => {
      closeStream();
      setStatus(isReconnect ? "reconnecting" : "streaming");
      setCurrentPrompt(prompt);
      activePromptRef.current = prompt;

      if (!isReconnect) {
        runIdRef.current = null;
        lastSeqRef.current = 0;
        localStorage.removeItem(runStorageKey);
      }

      const ctrl = new AbortController();
      ctrlRef.current = ctrl;

      const url = `${API_BASE.replace(/\/$/, "")}/api/chat`;

      fetchEventSource(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          prompt,
          sessionId,
          runId: isReconnect ? runIdRef.current : undefined,
          since: isReconnect ? lastSeqRef.current : 0,
        }),
        signal: ctrl.signal,

        async onopen(response) {
          if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
            return;
          }
          throw new Error(`Failed to open SSE stream: ${response.status}`);
        },

        onmessage(event) {
          const seq = Number(event.id);
          if (Number.isFinite(seq) && seq > lastSeqRef.current) {
            lastSeqRef.current = seq;
            saveStoredRun();
          }

          if (event.event === "run") {
            try {
              const payload = JSON.parse(event.data) as {
                runId?: string;
                status?: StoredRun["status"];
              };
              if (payload.runId) {
                runIdRef.current = payload.runId;
                saveStoredRun({ status: payload.status ?? "running" });
              }
            } catch (err: unknown) {
              console.error("Failed to parse run event", err, event.data);
            }
            return;
          }

          if (event.event === "done") {
            flushPendingText();
            saveStoredRun({ status: "completed" });
            setStatus("idle");
            closeStream("idle");
            setRetry(0);
            onDoneRef.current?.();
            return;
          }

          if (event.event === "error") {
            flushPendingText();
            saveStoredRun({ status: "failed" });
            setStatus("error");
            setCurrentPrompt(null);
            closeStream("error");
            return;
          }

          if (event.event === "message" || !event.event) {
            try {
              const message = JSON.parse(event.data) as Message;
              queueMessage(message);
            } catch (err: unknown) {
              console.error("Failed to parse SSE message", err, event.data);
            }
          }
        },

        onerror(err: unknown) {
          flushPendingText();
          console.error("SSE connection error:", err);
          setStatus("error");
          throw err;
        },
      }).catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setStatus("error");
      });
    },
    [closeStream, flushPendingText, queueMessage, runStorageKey, saveStoredRun, sessionId]
  );

  useEffect(() => {
    if (restoredSessionRef.current === sessionId) return;
    restoredSessionRef.current = sessionId;

    try {
      const raw = localStorage.getItem(runStorageKey);
      if (!raw) return;

      const stored = JSON.parse(raw) as StoredRun;
      if (stored.status !== "running" || !stored.runId || !stored.prompt) return;

      runIdRef.current = stored.runId;
      lastSeqRef.current = stored.lastSeq;
      activePromptRef.current = stored.prompt;
      queueMicrotask(() => openStream(stored.prompt, true));
    } catch (err: unknown) {
      console.error("Failed to restore active run", err);
    }
  }, [openStream, runStorageKey, sessionId]);

  useEffect(() => {
    if (status !== "error" || !currentPrompt) return;
    const timer = setTimeout(() => {
      const next = Math.min(5, retry + 1);
      setRetry(next);
      openStream(currentPrompt, true);
    }, Math.min(10_000, 800 * Math.pow(2, retry)));
    return () => clearTimeout(timer);
  }, [status, retry, currentPrompt, openStream]);

  useEffect(
    () => () => {
      flushPendingText();
      closeStream();
    },
    [closeStream, flushPendingText]
  );

  return { status, start: openStream, close: closeStream, pause };
}
