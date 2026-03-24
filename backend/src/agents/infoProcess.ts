import { v4 as uuid } from "uuid";
import { SSEClient, streamText } from "../sse.js";
import { TavilyResult } from "../types.js";
import { chatOnce } from "../llm.js";

export type ProcessingResult = {
  insights: string;
};

export async function runInformationProcessing(
  client: SSEClient,
  prompt: string,
  results: TavilyResult[]
): Promise<ProcessingResult> {
  const formatted = results
    .map((r, idx) => `${idx + 1}. ${r.title}\n${r.content}\n来源: ${r.url}`)
    .join("\n\n");

  const response = await chatOnce([
    {
      role: "system",
      content:
        "你是信息处理专家，请合并去重搜索结果，提炼关键洞见，强调可行结论和数据点。",
    } as any,
    {
      role: "human",
      content: `用户问题：${prompt}\n原始资料：\n${formatted}`,
    } as any,
  ]);

  await streamText(
    client,
    { id: uuid(), role: "agent" } as any,
    `处理完成，洞见摘要：\n${response}`
  );

  return { insights: response };
}
