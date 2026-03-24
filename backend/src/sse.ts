import { Response } from "express";
import { Message } from "./types";
// import { chatStream } from "./llm";

export type SSEClient = {
  res: Response;
  closed: boolean;
};

export function initSSE(res: Response): SSEClient {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8"); //设置 SSE 响应头
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.(); //作用 : 立即发送响应头到客户端

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
// // ✅ 新增：流式消息发送
// export async function streamText(
//   client: SSEClient,
//   base: Omit<Message, "content">,
//   fullTextOrMessages?: string | any[]
// ) {
//   const chunks: string[] = [];
  
//   // ✅ 直接调用流式生成器
//   if (typeof fullTextOrMessages === 'string') {
//     // 旧版本：直接发送文本
//     const fullText = fullTextOrMessages;
//     for (let i = 0; i < fullText.length; i += 60) {
//       const piece = fullText.slice(i, i + 60);
//       sendMessage(client, { 
//         ...base, 
//         type: "text", 
//         content: piece,
//         streaming: true 
//       } as any);
//     }
//   } else {
//     // 新版本：使用 chatStream 流式生成
//     const messages = fullTextOrMessages || [{ role: "user", content: "" }];
//     for await (const chunk of chatStream(messages)) {
//       chunks.push(chunk);
//       sendMessage(client, { 
//         ...base, 
//         type: "text", 
//         content: chunk,
//         streaming: true 
//       } as any);
//     }
//   }
  
//   return chunks.join("");
// }
