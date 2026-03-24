import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus, Message } from "../types/messages";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001";

type Props = {
  sessionId: string;
  onMessage: (message: Message) => void;
  onDone?: () => void;
};

export function useAgentStream({ sessionId, onMessage, onDone }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [retry, setRetry] = useState(0);
  const [currentPrompt, setCurrentPrompt] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const closeStream = useCallback((nextStatus?: ConnectionStatus) => {
    esRef.current?.close();
    esRef.current = null;
    if (nextStatus) setStatus(nextStatus);
  }, []);

  const pause = useCallback(() => {
    closeStream("paused");
    setRetry(0);
  }, [closeStream]);

  const openStream = useCallback(
    (prompt: string, isReconnect = false) => {
      closeStream();
      setStatus(isReconnect ? "reconnecting" : "streaming");
      setCurrentPrompt(prompt);
      const url = `${API_BASE.replace(/\/$/, "")}/api/chat?prompt=${encodeURIComponent(
        prompt
      )}&sessionId=${sessionId}`;
      const es = new EventSource(url);
      es.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as Message;
          onMessage(message);
        } catch (err) {
          console.error("解析消息失败", err, event.data);
        }
      };
      es.addEventListener("done", () => {
        setStatus("idle");
        closeStream("idle");
        setRetry(0);
        onDone?.();
      });
      es.addEventListener("error", () => {
        setStatus("error");
        closeStream("error");
      });
      esRef.current = es;
    },
    [closeStream, onDone, onMessage, sessionId]
  );

  useEffect(() => {
    if (status !== "error" || !currentPrompt) return;
    const timer = setTimeout(() => {
      const next = Math.min(5, retry + 1);
      setRetry(next);
      openStream(currentPrompt, true);
    }, Math.min(10_000, 800 * Math.pow(2, retry)));
    return () => clearTimeout(timer);
  }, [status, retry, currentPrompt, openStream]);

  useEffect(() => () => closeStream(), [closeStream]);

  return {
    status,
    start: openStream,
    close: closeStream,
    pause,
  };
}
