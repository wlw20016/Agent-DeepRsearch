import { v4 as uuid } from "uuid";
import { chatOnce } from "../llm.js";
import { Message, TavilyResult } from "../types.js";
import { SSEClient, sendMessage, streamText } from "../sse.js";
import { runInformationGathering } from "./infoGather.js";
import { runInformationProcessing } from "./infoProcess.js";
import { runReportGeneration } from "./report.js";
import { createApproval } from "../approval.js";

type PlanStep = {
  title: string;
  detail: string;
};

const FALLBACK_REPORT_NAME = "research-summary";

function buildReportFileName(prompt: string) {
  const cleaned = prompt.replace(/[<>:"/\\|?*\r\n]+/g, " ").trim();
  const short = cleaned ? cleaned.slice(0, 40).trim() : FALLBACK_REPORT_NAME;
  const safe = short.replace(/\s+/g, "_") || FALLBACK_REPORT_NAME;
  return `${safe}.md`;
}

async function buildPlan(prompt: string): Promise<PlanStep[]> {
  const response = await chatOnce([
    {
      role: "system",
      content:
        "你是任务规划 Agent，请把研究任务拆分为 3-5 步的可执行计划，输出 JSON 数组，字段 title 与 detail。",
    } as any,
    { role: "human", content: prompt } as any,
  ]);

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((p) => ({
          title: p.title ?? "步骤",
          detail: p.detail ?? "",
        }));
      }
    }
  } catch {
    /* ignore */
  }

  return [
    { title: "理解问题", detail: "解析用户意图与约束" },
    { title: "信息收集", detail: "使用网络搜索获取最新资料" },
    { title: "分析处理", detail: "去重、总结、提炼关键洞见" },
    { title: "报告生成", detail: "输出带引用的 Markdown 报告" },
  ];
}

async function maybeRequestApproval(client: SSEClient, reason: string): Promise<boolean> {
  const approval = createApproval();
  sendMessage(client, {
    id: uuid(),
    type: "humanInput",
    role: "agent",
    content: "需要用户批准",
    meta: { actionId: approval.id, reason },
  });
  const decision = await approval.wait();
  return decision === "approved";
}

export async function runRootAgent(client: SSEClient, prompt: string) {
  sendMessage(client, {
    id: uuid(),
    type: "text",
    role: "system",
    content: "启动 Plan & Execute 工作流...",
  });

  const plan = await buildPlan(prompt);
  const planText = plan.map((p, i) => `${i + 1}. ${p.title} - ${p.detail}`).join("\n");
  await streamText(client, { id: uuid(), role: "agent" } as Message, `执行计划：\n${planText}`);

  // Step 1: gather
  const requireApproval = prompt.toLowerCase().includes("成本") || prompt.toLowerCase().includes("支付");
  if (requireApproval) {
    const ok = await maybeRequestApproval(client, "即将进行可能高成本的外部检索，是否继续？");
    if (!ok) {
      sendMessage(client, {
        id: uuid(),
        type: "text",
        role: "system",
        content: "用户已拒绝继续执行。",
      });
      return;
    }
  }

  const gather = await runInformationGathering(client, prompt);

  // Step 2: process
  const process = await runInformationProcessing(client, prompt, gather.results);

  // Step 3: report
  const report = await runReportGeneration(client, prompt, process.insights, gather.results);

  // Attachment message
  sendMessage(client, {
    id: uuid(),
    type: "attachment",
    role: "agent",
    content: "研究报告已生成",
    meta: {
      url: "data:text/markdown;base64," + Buffer.from(report.markdown).toString("base64"),
      name: buildReportFileName(prompt),
    },
  });

  sendMessage(client, {
    id: uuid(),
    type: "text",
    role: "agent",
    content: "任务完成 ✅",
  });
}
