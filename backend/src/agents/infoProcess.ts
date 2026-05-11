import { v4 as uuid } from "uuid";
import { SSEClient, endTextStream, startTextStream, streamTokens } from "../sse.js";
import { RetrievedSource } from "../types.js";
import { chatStream } from "../llm.js";

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
  results: RetrievedSource[]
): Promise<ProcessingResult> {
  const formatted = results
    .map(
      (r, idx) =>
        `${idx + 1}. [${r.sourceType.toUpperCase()}] ${r.title}\n${r.content}\n来源: ${
          r.url ?? "N/A"
        }`
    )
    .join("\n\n");

  const messageId = uuid();
  const baseMessage = { id: messageId, role: "agent" as const };
  let insights = "";

  const responseStream = chatStream(
    [
      {
        role: "system",
        content:
          "你是信息处理专家。请合并去重混合检索结果，明确区分 KB 知识库与 WEB 网页来源；如果出现冲突，要指出冲突点与更可信的来源，并输出重点洞察、可执行结论和关键数据点。",
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
