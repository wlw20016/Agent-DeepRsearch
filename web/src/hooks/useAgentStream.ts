// import { useCallback, useEffect, useRef, useState } from "react";
// import type { ConnectionStatus, Message } from "../types/messages";

// const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001";

// type Props = {
//   sessionId: string;
//   onMessage: (message: Message) => void;
//   onDone?: () => void;
// };

// export function useAgentStream({ sessionId, onMessage, onDone }: Props) {
//   const [status, setStatus] = useState<ConnectionStatus>("idle");
//   const [retry, setRetry] = useState(0);
//   const [currentPrompt, setCurrentPrompt] = useState<string | null>(null);
//   const esRef = useRef<EventSource | null>(null);

//   const closeStream = useCallback((nextStatus?: ConnectionStatus) => {
//     esRef.current?.close();
//     esRef.current = null;
//     if (nextStatus) setStatus(nextStatus);
//   }, []);

//   const pause = useCallback(() => {
//     closeStream("paused");
//     setRetry(0);
//   }, [closeStream]);

//   const openStream = useCallback(
//     (prompt: string, isReconnect = false) => {
//       closeStream();
//       setStatus(isReconnect ? "reconnecting" : "streaming");
//       setCurrentPrompt(prompt);
//       const url = `${API_BASE.replace(/\/$/, "")}/api/chat?prompt=${encodeURIComponent(
//         prompt
//       )}&sessionId=${sessionId}`;
//       const es = new EventSource(url);
//       es.onmessage = (event) => {
//         try {
//           const message = JSON.parse(event.data) as Message;
//           onMessage(message);
//         } catch (err) {
//           console.error("解析消息失败", err, event.data);
//         }
//       };
//       es.addEventListener("done", () => {
//         setStatus("idle");
//         closeStream("idle");
//         setRetry(0);
//         onDone?.();
//       });
//       es.addEventListener("error", () => {
//         setStatus("error");
//         closeStream("error");
//       });
//       esRef.current = es;
//     },
//     [closeStream, onDone, onMessage, sessionId]
//   );

//   useEffect(() => {
//     if (status !== "error" || !currentPrompt) return;
//     const timer = setTimeout(() => {
//       const next = Math.min(5, retry + 1);
//       setRetry(next);
//       openStream(currentPrompt, true);
//     }, Math.min(10_000, 800 * Math.pow(2, retry)));
//     return () => clearTimeout(timer);
//   }, [status, retry, currentPrompt, openStream]);

//   useEffect(() => () => closeStream(), [closeStream]);

//   return {
//     status,
//     start: openStream,
//     close: closeStream,
//     pause,
//   };
// }

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { ConnectionStatus, Message } from "../types/messages";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type Props = {
  sessionId: string;
  onMessage: (message: Message) => void;
  onDone?: () => void;
};

export function useAgentStream({ sessionId, onMessage, onDone }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [retry, setRetry] = useState(0);
  const [currentPrompt, setCurrentPrompt] = useState<string | null>(null);
  
  // 架构核心 1：引入 AbortController，使得流式请求可以被真正地“物理中断”
  const ctrlRef = useRef<AbortController | null>(null);

  const closeStream = useCallback((nextStatus?: ConnectionStatus) => {
    if (ctrlRef.current) {
      ctrlRef.current.abort(); // 物理终止底层 Fetch 连接
      ctrlRef.current = null;
    }
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

      const ctrl = new AbortController();
      ctrlRef.current = ctrl;

      const url = `${API_BASE.replace(/\/$/, "")}/api/chat`;

      // 架构核心 2：使用 fetchEventSource 发起 POST 请求
      fetchEventSource(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },
        // 将核心数据放入请求体（Body）中，彻底解除长度封印与明文泄露风险
        body: JSON.stringify({ prompt, sessionId }),
        signal: ctrl.signal,
        
        //SSE链接建立后，立即执行。每次连接只执行一次
        async onopen(response) {
          if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
            return; // 握手成功
          }
          throw new Error(`连接流失败, 状态码: ${response.status}`);
        },
        
        //每次收到消息时执行
        onmessage(event) {
          if (event.event === "done") {
            setStatus("idle");
            closeStream("idle");
            setRetry(0);
            onDone?.();
            return;
          }
          if (event.event === "error") {
            setStatus("error");
            closeStream("error");
            return;
          }
          
          // 默认 message 事件
          if (event.event === "message" || !event.event) {
            try {
              const message = JSON.parse(event.data) as Message;
              onMessage(message);
            } catch (err: unknown) {
              console.error("解析消息失败", err, event.data);
            }
          }
        },
        
        onerror(err: unknown) {
          console.error("SSE 连接异常:", err);
          setStatus("error");
          // 抛出错误以阻断 fetchEventSource 内部的默认重连，交由我们外部的 useEffect 指数退避逻辑接管
          throw err; 
        }
      }).catch((err: unknown) => {
        // 如果是我们手动触发的 abort，忽略报错
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setStatus("error");
      });
    },
    [closeStream, onDone, onMessage, sessionId]
  );

  // 原有的重连指数退避逻辑保持不变
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

  return { status, start: openStream, close: closeStream, pause };
}
