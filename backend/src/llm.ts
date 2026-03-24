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
// import { ChatOpenAI } from "@langchain/openai";
// import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
// import { config } from "./env";

// type ChatMessage = SystemMessage | HumanMessage | AIMessage;

// const hasDeepseekKey = Boolean(config.deepseek.apiKey);

// const buildClient = () =>
//   new ChatOpenAI({
//     apiKey: config.deepseek.apiKey || "DUMMY",
//     model: config.deepseek.model,
//     temperature: 0.3,
//     streaming: true, // ✅ 启用流式
//     configuration: {
//       baseURL: config.deepseek.baseUrl,
//     },
//   });

// const fallbackRespond = async (messages: ChatMessage[]) => {
//   const last = messages[messages.length - 1];
//   const promptText = "content" in last ? (last as any).content : "";
//   return `（演示模式）根据指令生成的简要回复：${promptText}`;
// };

// // ✅ 改为流式生成器
// export async function* chatStream(messages: ChatMessage[]): AsyncGenerator<string> {
//   if (!hasDeepseekKey) {
//     const fallbackText = await fallbackRespond(messages);
//     yield* fallbackText.split(" "); // 简单分词模拟
//     return;
//   }

//   const client = buildClient();
  
//   // ✅ 使用 stream() 获取流式响应
//   const stream = await client.stream(messages);
  
//   for await (const chunk of stream) {
//     if (Array.isArray(chunk.content)) {
//       const text = chunk.content.map((c: any) => c.text ?? "").join("");
//       yield text; // ✅ 每次生成一个 chunk 就返回
//     } else {
//       yield String(chunk.content);
//     }
//   }
// }

// // 保留原有的 chatOnce 用于非流式场景
// export async function chatOnce(messages: ChatMessage[]): Promise<string> {
//   if (!hasDeepseekKey) {
//     return fallbackRespond(messages);
//   }
//   const client = buildClient();
//   const response = await client.invoke(messages); // ✅ 改为 invoke
//   if (Array.isArray(response.content)) {
//     return response.content.map((c: any) => c.text ?? "").join("");
//   }
//   return String(response.content);
// }