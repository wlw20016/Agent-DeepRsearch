import { Response } from "express";
import { Message } from "./types";
// import { chatStream } from "./llm";

export type SSEClient = {
  res: Response;
  closed: boolean;
  abortController: AbortController;
};

export function initSSE(res: Response): SSEClient {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8"); //设置 SSE 响应头
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.(); //作用 : 立即发送响应头到客户端

  // 2. 实例化 AbortController
  const abortController = new AbortController();

  const client: SSEClient = { res, closed: false, abortController};
  res.on("close", () => {
    client.closed = true;
    abortController.abort();
  });

  // 初始心跳
  res.write(`event: ping\ndata: "ready"\n\n`);
  return client;
}

export function sendMessage(client: SSEClient, message: Message) {
  if (client.closed) return;
  client.res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

export function sendDone(client: SSEClient) {
  if (client.closed) return;
  client.res.write(`event: done\ndata: "complete"\n\n`);
}

export function sendError(client: SSEClient, error: string) {
  if (client.closed) return;
  client.res.write(`event: error\ndata: ${JSON.stringify(error)}\n\n`);
}

//模拟的流式文本发送
export async function streamText(
  client: SSEClient,
  base: Omit<Message, "content">,
  fullText: string,
  chunkSize = 60
) {
  for (let i = 0; i < fullText.length; i += chunkSize) {
    const piece = fullText.slice(i, i + chunkSize);
    sendMessage(client, { ...base, type: "text", content: piece, streaming: true } as any);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

// 在 sse.ts 中新增此函数
export async function streamTokens(
  client: SSEClient,
  base: Omit<Message, "content">,
  tokenStream: AsyncGenerator<string, void, unknown>
) {
  // 遍历迭代器，拿到真实的 Token 切片
  for await (const token of tokenStream) {
    // 架构关键：如果用户强制刷新了浏览器导致连接断开，立即打断循环
    // 配合后端大模型调用的 abort 机制，可以立刻切断与 DeepSeek 的连接，节省 API 费用
    if (client.closed) break;
    
    // 直接将这一个 Token 通过 SSE 推给前端
    sendMessage(client, { ...base, type: "text", content: token, streaming: true } as any);
  }
}