import { v4 as uuid } from "uuid";
import { SSEClient, endTextStream, startTextStream, streamTokens } from "../sse";
import { TavilyResult } from "../types";
import { chatStream } from "../llm";

export type ProcessingResult = {
  insights: string;
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

export async function runInformationProcessing(
  client: SSEClient,
  prompt: string,
  results: TavilyResult[]
): Promise<ProcessingResult> {
  const formatted = results
    .map((r, idx) => `${idx + 1}. ${r.title}\n${r.content}\n来源: ${r.url}`)
    .join("\n\n");

  const messageId = uuid();
  const baseMessage = { id: messageId, role: "agent" as const };
  let insights = "";

  const responseStream = chatStream(
    [
      {
        role: "system",
        content: "你是信息处理专家，请合并去重搜索结果，提炼关键洞察，强调可行结论和数据点。",
      } as any,
      {
        role: "human",
        content: `用户问题：${prompt}\n原始资料：\n${formatted}`,
      } as any,
    ],
    client.abortController.signal
  );

  startTextStream(client, baseMessage, "处理完成，洞察摘要如下：\n");
  await streamTokens(
    client,
    baseMessage,
    tapStream(responseStream, (token) => {
      insights += token;
    })
  );
  endTextStream(client, baseMessage);

  return { insights };
}
