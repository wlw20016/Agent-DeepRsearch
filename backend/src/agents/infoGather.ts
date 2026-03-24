import { v4 as uuid } from "uuid";
import { chatOnce } from "../llm.js";
import { tavilySearch } from "../tools/tavily.js";
import { Message, TavilyResult } from "../types.js";
import { SSEClient, sendMessage, streamText } from "../sse.js";

export type GatherResult = {
  results: TavilyResult[];
  summary: string;
};

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
    meta: { task: `针对「${userQuery}」进行网络搜索`, agent: agentName },
  });

  // ReAct: 思考 -> Action (web_search调用tavily api) -> 观察/总结
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
      content:
        "你是信息收集助理，请用最多30条要点总结搜索结果，并保留可引用的URL列表。",
    },
    { role: "human", content: `用户问题：${userQuery}\n搜索结果：\n${combined}` },
  ] as any;

  const summary = await chatOnce(summaryPrompt);

  await streamText(
    client,
    { id: uuid(), role: "agent" } as Message,
    `收集完成，关键发现：\n${summary}`
  );

  return { results, summary };
}
