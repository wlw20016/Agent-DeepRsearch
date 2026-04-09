import { v4 as uuid } from "uuid";
import { chatStream } from "../llm";
import { tavilySearch } from "../tools/tavily";
import { TavilyResult } from "../types";
import { SSEClient, endTextStream, sendMessage, startTextStream, streamTokens } from "../sse";

export type GatherResult = {
  results: TavilyResult[];
  summary: string;
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

export async function runInformationGathering(
  client: SSEClient,
  userQuery: string
): Promise<GatherResult> {
  const agentName = "信息收集 Agent";

  sendMessage(client, {
    id: uuid(),
    type: "subAgentCall",
    role: "agent",
    content: agentName,
    meta: { task: `针对“${userQuery}”进行网络搜索`, agent: agentName },
  });

  sendMessage(client, {
    id: uuid(),
    type: "toolCall",
    role: "agent",
    content: "web_search",
    meta: { tool: "web_search", input: userQuery },
  });

  const results = await tavilySearch(userQuery);

  sendMessage(client, {
    id: uuid(),
    type: "toolResult",
    role: "agent",
    content: "web_search 完成",
    meta: { tool: "web_search", result: results },
  });

  const combined = results
    .map((r, idx) => `${idx + 1}. ${r.title}\nURL: ${r.url}\n内容: ${r.content}`)
    .join("\n\n");

  const summaryPrompt = [
    {
      role: "system",
      content: "你是信息收集助理，请用最多 10 条要点总结搜索结果，并保留可引用的 URL 列表。",
    },
    {
      role: "human",
      content: `用户问题：${userQuery}\n搜索结果：\n${combined}`,
    },
  ] as any;

  const messageId = uuid();
  const baseMessage = { id: messageId, role: "agent" as const };
  let summary = "";

  startTextStream(client, baseMessage, "收集完成，关键信息如下：\n");
  await streamTokens(
    client,
    baseMessage,
    tapStream(chatStream(summaryPrompt, client.abortController.signal), (token) => {
      summary += token;
    })
  );
  endTextStream(client, baseMessage);

  return { results, summary };
}
