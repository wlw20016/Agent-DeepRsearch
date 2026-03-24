import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { config } from "./env.js";

type ChatMessage = SystemMessage | HumanMessage | AIMessage;

const hasDeepseekKey = Boolean(config.deepseek.apiKey);

const buildClient = () =>
  new ChatOpenAI({
    apiKey: config.deepseek.apiKey || "DUMMY",
    model: config.deepseek.model,
    temperature: 0.3,
    streaming: false,
    configuration: {
      baseURL: config.deepseek.baseUrl,
    },
  });

const fallbackRespond = async (messages: ChatMessage[]) => {
  const last = messages[messages.length - 1];
  const promptText = "content" in last ? (last as any).content : "";
  return `（演示模式）根据指令生成的简要回复：${promptText}`;
};

export async function chatOnce(messages: ChatMessage[]): Promise<string> {
  if (!hasDeepseekKey) {
    return fallbackRespond(messages);
  }
  const client = buildClient();
  const response = await client.invoke(messages);
  if (Array.isArray(response.content)) {
    return response.content.map((c: any) => c.text ?? "").join("");
  }
  return String(response.content);
}
