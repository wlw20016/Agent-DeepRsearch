import { Response } from "express";
import { Message } from "./types.js";

export type SSEClient = {
  res: Response;
  closed: boolean;
};

export function initSSE(res: Response): SSEClient {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const client: SSEClient = { res, closed: false };
  res.on("close", () => {
    client.closed = true;
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
