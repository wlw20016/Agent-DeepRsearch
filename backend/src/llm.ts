
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { config } from "./env.js";

type ChatMessage = SystemMessage | HumanMessage | AIMessage;

const hasDeepseekKey = Boolean(config.deepseek.apiKey);

//配置LLM 客户端构建
const buildClient = () =>
  new ChatOpenAI({
    apiKey: config.deepseek.apiKey || "DUMMY",
    model: config.deepseek.model,
    temperature: 0.3,
    // streaming: true 不必显式设置，.stream() 方法会自动触发流式请求
    configuration: {
      baseURL: config.deepseek.baseUrl,
    },
  });

//兜底方案
const fallbackRespond = async (messages: ChatMessage[]) => {
  const last = messages[messages.length - 1];
  const promptText = last && "content" in last ? (last as any).content : "";
  return `（演示模式）根据指令生成的简要回复：${promptText}`;
};

// // 给大模型发消息，并接收他的返回信息
// export async function chatOnce(messages: ChatMessage[]): Promise<string> {
//   if (!hasDeepseekKey) {
//     return fallbackRespond(messages);
//   }
//   const client = buildClient();
//   const response = await client.invoke(messages);
//   if (Array.isArray(response.content)) {
//     return response.content.map((c: any) => c.text ?? "").join("");
//   }
//   return String(response.content);
// }
// chatOnce函数是直接接收大模型返回的回答的
// 1. 接收 signal 参数 
export async function chatOnce(
  messages: ChatMessage[], 
  signal?: AbortSignal
): Promise<string> {
  if (!config.deepseek.apiKey) {
    return fallbackRespond(messages);
  }
  const client = buildClient();
  
  // 2. 将 signal 注入给 LangChain 的 invoke 选项中
  const response = await client.invoke(messages, { signal });
  
  if (Array.isArray(response.content)) {
    return response.content.map((c: any) => c.text ?? "").join("");
  }
  return String(response.content);
}


// 【新增真流式】利用 AsyncGenerator 实时产出 Token
export async function* chatStream(
  messages: ChatMessage[],
  signal? : AbortSignal
): AsyncGenerator<string, void, unknown> {
  if (!hasDeepseekKey) {
    // 演示模式下，模拟流式输出，将演示文本当做一个大 Token 推送
    yield await fallbackRespond(messages);
    return;
  }
  
  const client = buildClient();
  // 调用底层的 stream 方法，发起真正的 SSE 请求到大模型厂商服务器
  const stream = await client.stream(messages, {signal});
  
  // 消费大模型的流
  for await (const chunk of stream) {
    if (typeof chunk.content === "string") {
      yield chunk.content;
    } else if (Array.isArray(chunk.content)) {
      yield chunk.content.map((c: any) => c.text ?? "").join("");
    }
  }
}
