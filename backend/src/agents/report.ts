import { v4 as uuid } from "uuid";
import { SSEClient, sendMessage } from "../sse.js";
import { TavilyResult, Message } from "../types.js";
import { chatStream } from "../llm.js";
// 引入强类型的 Message 类，摒弃 any
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export type ReportResult = {
  markdown: string;
};

export async function runReportGeneration(
  client: SSEClient,
  prompt: string,
  insights: string,
  sources: TavilyResult[]
): Promise<ReportResult> {
  const sourcesText = sources
    .map((s, idx) => `[${idx + 1}] ${s.title} (${s.url})\n${s.content}`)
    .join("\n\n");

  // 1. 构建强类型消息数组，代替原先的 as any
  const messages = [
    new SystemMessage(
      "你是报告生成 Agent，请用 Markdown 生成结构化研究报告，包含摘要、背景、发现、建议、引用。引用处附上来源编号。"
    ),
    new HumanMessage(`用户问题：${prompt}\n洞见：${insights}\n来源：\n${sourcesText}`),
  ];

  const messageId = uuid();
  let fullMarkdown = "";

  // 2. 发送状态提示语（开启流式状态）
  const initialMessage: Message = {
    id: messageId,
    type: "text",
    role: "agent",
    content: "报告生成中...\n\n",
    streaming: true,
  };
  sendMessage(client, initialMessage);

  // 3. 获取大模型底层的异步流迭代器（显式透传 abort signal）
  const stream = chatStream(messages, client.abortController.signal);

  // 4. 核心管道：消费 Token、实时推送、内存累加
  try {
    for await (const token of stream) {
      // 熔断机制：如果用户断开连接（如刷新页面），立刻打断循环，节省后续大模型推理算力
      if (client.closed) break;

      fullMarkdown += token;

      // 将每一个极其微小的 Token 立刻发给前端浏览器
      const chunkMessage: Message = {
        id: messageId,
        type: "text",
        role: "agent",
        content: token,
        streaming: true,
      };
      sendMessage(client, chunkMessage);
    }
  } catch (error: unknown) {
    const isAbortError =
      error instanceof Error &&
      (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

    if (!isAbortError) {
      throw error;
    }
  }

  // 5. 循环结束，返回拼接完成的完整报告给 root.ts 处理附件逻辑
  return { markdown: fullMarkdown };
}
