import { v4 as uuid } from "uuid";
import { SSEClient, streamText } from "../sse.js";
import { TavilyResult } from "../types.js";
import { chatOnce } from "../llm.js";

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
  const response = await chatOnce([
    {
      role: "system",
      content:
        "你是报告生成 Agent，请用 Markdown 生成结构化研究报告，包含摘要、背景、发现、建议、引用。引用处附上来源编号。",
    } as any,
    {
      role: "human",
      content: `用户问题：${prompt}\n洞见：${insights}\n来源：\n${sourcesText}`,
    } as any,
  ]);

  await streamText(
    client,
    { id: uuid(), role: "agent" } as any,
    "报告生成中...\n" + response
  );

  return { markdown: response };
}
