import { v4 as uuid } from "uuid";
import { chatOnce } from "../llm";
import { SSEClient, endTextStream, sendMessage, startTextStream } from "../sse";
import { runInformationGathering } from "./infoGather";
import { runInformationProcessing } from "./infoProcess";
import { runReportGeneration } from "./report";
import { createApproval } from "../approval";

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
      content: "你是任务规划 Agent，请把研究任务拆分为 3-5 步的可执行计划，输出 JSON 数组，字段为 title 和 detail。",
    } as any,
    { role: "human", content: prompt } as any,
  ]);

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((item) => ({
          title: item.title ?? "步骤",
          detail: item.detail ?? "",
        }));
      }
    }
  } catch {
    /* ignore invalid JSON and fall back */
  }

  return [
    { title: "理解问题", detail: "解析用户意图与约束" },
    { title: "信息收集", detail: "使用网络搜索获取最新资料" },
    { title: "分析处理", detail: "去重、总结、提炼关键洞察" },
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
  const planText = plan.map((step, index) => `${index + 1}. ${step.title} - ${step.detail}`).join("\n");
  const planMessage = { id: uuid(), role: "agent" as const };

  startTextStream(client, planMessage, `执行计划：\n${planText}`);
  endTextStream(client, planMessage);

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
  const process = await runInformationProcessing(client, prompt, gather.results);
  const report = await runReportGeneration(client, prompt, process.insights, gather.results);

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
    content: "任务完成。",
  });
}
