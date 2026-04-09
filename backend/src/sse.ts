import { Response } from "express";
import { Message } from "./types";

export type SSEClient = {
  res: Response;
  closed: boolean;
  abortController: AbortController;
};

type TextStreamBase = Pick<Extract<Message, { type: "text" }>, "id" | "role">;

export function initSSE(res: Response): SSEClient {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const abortController = new AbortController();
  const client: SSEClient = { res, closed: false, abortController };

  res.on("close", () => {
    client.closed = true;
    abortController.abort();
  });

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

export function startTextStream(client: SSEClient, base: TextStreamBase, content = "") {
  sendMessage(client, {
    ...base,
    type: "text",
    content,
    streaming: true,
  });
}

export function endTextStream(client: SSEClient, base: TextStreamBase) {
  sendMessage(client, {
    ...base,
    type: "text",
    content: "",
    streaming: false,
  });
}

export async function streamTokens(
  client: SSEClient,
  base: TextStreamBase,
  tokenStream: AsyncGenerator<string, void, unknown>
) {
  for await (const token of tokenStream) {
    if (client.closed) break;

    sendMessage(client, {
      ...base,
      type: "text",
      content: token,
      streaming: true,
    });
  }
}
