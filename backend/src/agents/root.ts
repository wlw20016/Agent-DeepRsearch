import { v4 as uuid } from "uuid";
import { SSEClient, sendMessage } from "../sse.js";
import { buildReportFileName, runResearchGraph } from "./graph.js";

export async function runRootAgent(client: SSEClient, prompt: string) {
  sendMessage(client, {
    id: uuid(),
    type: "text",
    role: "system",
    content: "启动 LangGraph 研究工作流...",
  });

  const result = await runResearchGraph(client, prompt);
  if (result.aborted) {
    return;
  }

  sendMessage(client, {
    id: uuid(),
    type: "attachment",
    role: "agent",
    content: "研究报告已生成",
    meta: {
      url: "data:text/markdown;base64," + Buffer.from(result.reportMarkdown).toString("base64"),
      name: buildReportFileName(prompt),
    },
  });

  sendMessage(client, {
    id: uuid(),
    type: "text",
    role: "agent",
    content: "任务完成。",
  });
}
