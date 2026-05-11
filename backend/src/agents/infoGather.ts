import { v4 as uuid } from "uuid";
import { chatStream } from "../llm.js";
import { searchKnowledgeBase } from "../tools/rag.js";
import { tavilySearch } from "../tools/tavily.js";
import { RetrievedSource } from "../types.js";
import {
  SSEClient,
  endTextStream,
  sendMessage,
  startTextStream,
  streamTokens,
} from "../sse.js";

export type GatherResult = {
  results: RetrievedSource[];
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

function formatSource(source: RetrievedSource, index: number) {
  return `${index + 1}. [${source.sourceType.toUpperCase()}] ${source.title}\nURL/Path: ${
    source.url ?? "N/A"
  }\n内容: ${source.content}`;
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
    meta: { task: `针对“${userQuery}”执行混合检索`, agent: agentName },
  });

  sendMessage(client, {
    id: uuid(),
    type: "toolCall",
    role: "agent",
    content: "hybrid_retrieval",
    meta: { tool: "hybrid_retrieval", input: userQuery },
  });

  const [webResults, kbResults] = await Promise.all([
    tavilySearch(userQuery),
    searchKnowledgeBase(userQuery),
  ]);
  const results = [...kbResults, ...webResults];

  sendMessage(client, {
    id: uuid(),
    type: "toolResult",
    role: "agent",
    content: "hybrid_retrieval 完成",
    meta: {
      tool: "hybrid_retrieval",
      result: {
        total: results.length,
        knowledgeBase: kbResults.length,
        web: webResults.length,
        items: results,
      },
    },
  });

  const combined = results.map(formatSource).join("\n\n");
  const summaryPrompt = [
    {
      role: "system",
      content:
        "你是信息收集助理。请用最多 10 条要点总结混合检索结果，明确区分 [KB] 与 [WEB] 来源，并保留最值得后续引用的来源标识。",
    },
    {
      role: "human",
      content: `用户问题：${userQuery}\n检索结果：\n${combined}`,
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
