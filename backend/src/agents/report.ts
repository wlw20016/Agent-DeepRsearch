import { v4 as uuid } from "uuid";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { SSEClient, endTextStream, startTextStream, streamTokens } from "../sse.js";
import { TavilyResult } from "../types.js";
import { chatStream } from "../llm.js";

export type ReportResult = {
  markdown: string;
};

async function* tapStream(
  stream: AsyncGenerator<string, void, unknown>,
  onToken: (token: string) => void
) {
  for await (const token of stream) {
    onToken(token);
    yield token;
  }
}

export async function runReportGeneration(
  client: SSEClient,
  prompt: string,
  insights: string,
  sources: TavilyResult[]
): Promise<ReportResult> {
  const sourcesText = sources
    .map((source, index) => `[${index + 1}] ${source.title} (${source.url})\n${source.content}`)
    .join("\n\n");

  const messages = [
    new SystemMessage(
      "你是报告生成 Agent，请使用 Markdown 生成结构化研究报告，包含摘要、背景、发现、建议、引用。引用处附上来源编号。"
    ),
    new HumanMessage(`用户问题：${prompt}\n洞察：${insights}\n来源：\n${sourcesText}`),
  ];

  const messageId = uuid();
  const baseMessage = { id: messageId, role: "agent" as const };
  let markdown = "";

  startTextStream(client, baseMessage, "报告生成中...\n\n");

  try {
    await streamTokens(
      client,
      baseMessage,
      tapStream(chatStream(messages, client.abortController.signal), (token) => {
        markdown += token;
      })
    );
  } catch (error: unknown) {
    const isAbortError =
      error instanceof Error &&
      (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

    if (!isAbortError) {
      throw error;
    }
  } finally {
    endTextStream(client, baseMessage);
  }

  return { markdown };
}
