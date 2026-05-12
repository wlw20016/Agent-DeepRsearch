import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { v4 as uuid } from "uuid";
import { createApproval } from "../approval.js";
import { chatOnce } from "../llm.js";
import { SSEClient, endTextStream, sendMessage, startTextStream } from "../sse.js";
import { searchKnowledgeBase } from "../tools/rag.js";
import { tavilySearch } from "../tools/tavily.js";
import { RetrievedSource } from "../types.js";
import { runInformationProcessing } from "./infoProcess.js";
import { runReportGeneration } from "./report.js";

type ResearchTaskType = "research" | "analysis" | "synthesis";

type ResearchTask = {
  id: string;
  title: string;
  detail: string;
  type: ResearchTaskType;
  query: string;
  acceptanceCriteria: string[];
};

type TaskResult = {
  taskId: string;
  title: string;
  insight: string;
  sourceIds: string[];
  evaluationSummary: string;
};

type SourceAssessment = {
  sourceId: string;
  title: string;
  sourceType: RetrievedSource["sourceType"];
  reliabilityScore: number;
  citationPriority: number;
  reasons: string[];
};

type SourceEvaluation = {
  totalInput: number;
  totalDeduped: number;
  duplicateCount: number;
  kbCount: number;
  webCount: number;
  averageReliability: number;
  citationCandidateIds: string[];
  assessments: SourceAssessment[];
  conflicts: string[];
  gaps: string[];
  summary: string;
};

export type ResearchGraphResult = {
  reportMarkdown: string;
  aborted: boolean;
};

const FALLBACK_REPORT_NAME = "research-summary";

const ResearchState = Annotation.Root({
  prompt: Annotation<string>(),
  tasks: Annotation<ResearchTask[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  currentTaskIndex: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  kbSources: Annotation<RetrievedSource[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  webSources: Annotation<RetrievedSource[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  sources: Annotation<RetrievedSource[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  allSources: Annotation<RetrievedSource[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  sourceEvaluation: Annotation<SourceEvaluation | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  taskResults: Annotation<TaskResult[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  reportMarkdown: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  aborted: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false,
  }),
});

type ResearchStateValue = typeof ResearchState.State;

export function buildReportFileName(prompt: string) {
  const cleaned = prompt.replace(/[<>:"/\\|?*\r\n]+/g, " ").trim();
  const short = cleaned ? cleaned.slice(0, 40).trim() : FALLBACK_REPORT_NAME;
  const safe = short.replace(/\s+/g, "_") || FALLBACK_REPORT_NAME;
  return `${safe}.md`;
}

function fallbackTasks(prompt: string): ResearchTask[] {
  return [
    {
      id: "task-1",
      title: "Clarify scope and background",
      detail: "Identify the core question, background context, and relevant constraints.",
      type: "research",
      query: prompt,
      acceptanceCriteria: ["The task scope is clear", "Important background facts are collected"],
    },
    {
      id: "task-2",
      title: "Collect and verify evidence",
      detail: "Search for supporting sources and compare evidence quality.",
      type: "research",
      query: `${prompt} evidence sources data`,
      acceptanceCriteria: ["Multiple independent sources are available", "Weak sources are flagged"],
    },
    {
      id: "task-3",
      title: "Synthesize conclusions",
      detail: "Turn verified evidence into actionable findings for the final report.",
      type: "synthesis",
      query: `${prompt} analysis conclusions recommendations`,
      acceptanceCriteria: ["Key findings are explicit", "Remaining uncertainty is stated"],
    },
  ];
}

function normalizeTask(raw: any, index: number, prompt: string): ResearchTask {
  const title = String(raw?.title || raw?.name || `Task ${index + 1}`);
  const detail = String(raw?.detail || raw?.description || "");
  const type = ["research", "analysis", "synthesis"].includes(raw?.type)
    ? raw.type
    : index === 0
      ? "research"
      : index === 1
        ? "analysis"
        : "synthesis";

  const criteria = Array.isArray(raw?.acceptanceCriteria)
    ? raw.acceptanceCriteria.map(String).filter(Boolean)
    : Array.isArray(raw?.acceptance_criteria)
      ? raw.acceptance_criteria.map(String).filter(Boolean)
      : [];

  return {
    id: String(raw?.id || `task-${index + 1}`),
    title,
    detail,
    type,
    query: String(raw?.query || `${prompt} ${title} ${detail}`.trim()),
    acceptanceCriteria: criteria.length ? criteria : ["Task output is useful for final report"],
  };
}

async function buildTasks(prompt: string): Promise<ResearchTask[]> {
  const response = await chatOnce([
    {
      role: "system",
      content: [
        "You are a Plan & Execute planner.",
        "Create a concrete execution checklist for a research agent.",
        "Return only a JSON array. Each item must include:",
        "id, title, detail, type, query, acceptanceCriteria.",
        "type must be one of: research, analysis, synthesis.",
        "Each query should be directly usable by retrieval nodes.",
      ].join("\n"),
    } as any,
    { role: "human", content: prompt } as any,
  ]);

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.slice(0, 6).map((item, index) => normalizeTask(item, index, prompt));
      }
    }
  } catch {
    /* fall through to deterministic fallback */
  }

  return fallbackTasks(prompt);
}

async function maybeRequestApproval(client: SSEClient, reason: string): Promise<boolean> {
  const approval = createApproval();
  sendMessage(client, {
    id: uuid(),
    type: "humanInput",
    role: "agent",
    content: "User approval required",
    meta: { actionId: approval.id, reason },
  });
  const decision = await approval.wait();
  return decision === "approved";
}

function emitNodeStart(client: SSEClient, node: string, task: string) {
  sendMessage(client, {
    id: uuid(),
    type: "subAgentCall",
    role: "agent",
    content: node,
    meta: { agent: node, task },
  });
}

function emitNodeDone(client: SSEClient, node: string, result: unknown) {
  sendMessage(client, {
    id: uuid(),
    type: "toolResult",
    role: "agent",
    content: `${node} completed`,
    meta: {
      tool: "langgraph_node",
      result,
    },
  });
}

function emitToolCall(client: SSEClient, tool: string, input: unknown) {
  sendMessage(client, {
    id: uuid(),
    type: "toolCall",
    role: "agent",
    content: tool,
    meta: { tool, input },
  });
}

function emitToolResult(client: SSEClient, tool: string, result: unknown) {
  sendMessage(client, {
    id: uuid(),
    type: "toolResult",
    role: "agent",
    content: `${tool} completed`,
    meta: { tool, result },
  });
}

function shouldRequestApproval(prompt: string) {
  const lower = prompt.toLowerCase();
  return lower.includes("成本") || lower.includes("支付") || lower.includes("cost");
}

function currentTask(state: ResearchStateValue) {
  return state.tasks[state.currentTaskIndex];
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function sourceKey(source: RetrievedSource) {
  const urlOrDoc = source.url ?? source.docId ?? "";
  const title = normalizeText(source.title);
  const content = normalizeText(source.content).slice(0, 220);
  return `${source.sourceType}|${urlOrDoc}|${title}|${content}`;
}

function sourceDomain(source: RetrievedSource) {
  if (!source.url) return "";
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function scoreSource(source: RetrievedSource): SourceAssessment {
  const reasons: string[] = [];
  let score = 0.45;

  if (source.sourceType === "kb") {
    score += 0.25;
    reasons.push("local knowledge base source");
  }

  if (source.score !== undefined) {
    score += Math.min(0.2, Math.max(0, source.score) * 0.2);
    reasons.push("retrieval score available");
  }

  const domain = sourceDomain(source);
  if (domain) {
    score += 0.05;
    reasons.push(`web domain: ${domain}`);
  }

  if (source.content.length > 600) {
    score += 0.1;
    reasons.push("substantial content length");
  } else if (source.content.length < 120) {
    score -= 0.12;
    reasons.push("very short snippet");
  }

  if (/example\.com|demo/i.test(source.url ?? source.id)) {
    score -= 0.25;
    reasons.push("demo or placeholder source");
  }

  const reliabilityScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return {
    sourceId: source.id,
    title: source.title,
    sourceType: source.sourceType,
    reliabilityScore,
    citationPriority: 0,
    reasons,
  };
}

function extractNumberClaims(source: RetrievedSource) {
  const matches = source.content.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];
  return [...new Set(matches)].slice(0, 12).map((value) => ({
    sourceId: source.id,
    title: source.title,
    value,
  }));
}

function detectConflicts(sources: RetrievedSource[]) {
  const byTitleToken = new Map<string, Map<string, string[]>>();

  for (const source of sources) {
    const token = normalizeText(source.title).split(" ").slice(0, 4).join(" ");
    if (!token) continue;
    const claims = extractNumberClaims(source);
    if (!claims.length) continue;

    const valueMap = byTitleToken.get(token) ?? new Map<string, string[]>();
    for (const claim of claims) {
      const sourceIds = valueMap.get(claim.value) ?? [];
      sourceIds.push(claim.sourceId);
      valueMap.set(claim.value, sourceIds);
    }
    byTitleToken.set(token, valueMap);
  }

  const conflicts: string[] = [];
  for (const [token, valueMap] of byTitleToken) {
    if (valueMap.size > 1) {
      conflicts.push(
        `Potential numeric mismatch around "${token}": ${Array.from(valueMap.keys())
          .slice(0, 5)
          .join(", ")}`
      );
    }
  }

  return conflicts.slice(0, 6);
}

function dedupeSources(sources: RetrievedSource[]) {
  const deduped = new Map<string, RetrievedSource>();
  for (const source of sources) {
    const key = sourceKey(source);
    const existing = deduped.get(key);
    if (!existing || (source.score ?? 0) > (existing.score ?? 0)) {
      deduped.set(key, source);
    }
  }
  return Array.from(deduped.values());
}

function evaluateSources(kbSources: RetrievedSource[], webSources: RetrievedSource[]) {
  const input = [...kbSources, ...webSources];
  const sources = dedupeSources(input);
  const assessments = sources
    .map(scoreSource)
    .sort((left, right) => right.reliabilityScore - left.reliabilityScore)
    .map((assessment, index) => ({
      ...assessment,
      citationPriority: index + 1,
    }));

  const assessmentById = new Map(assessments.map((item) => [item.sourceId, item]));
  const rankedSources = sources.sort((left, right) => {
    const leftScore = assessmentById.get(left.id)?.reliabilityScore ?? 0;
    const rightScore = assessmentById.get(right.id)?.reliabilityScore ?? 0;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return Number(right.sourceType === "kb") - Number(left.sourceType === "kb");
  });

  const averageReliability = assessments.length
    ? Number(
        (
          assessments.reduce((sum, assessment) => sum + assessment.reliabilityScore, 0) /
          assessments.length
        ).toFixed(2)
      )
    : 0;

  const gaps: string[] = [];
  if (!kbSources.length) gaps.push("No local knowledge base evidence was found.");
  if (!webSources.length) gaps.push("No web evidence was found.");
  if (rankedSources.length < 3) gaps.push("Fewer than three distinct sources are available.");
  if (averageReliability < 0.45 && rankedSources.length) {
    gaps.push("Average source reliability is low; conclusions should be conservative.");
  }

  const evaluation: SourceEvaluation = {
    totalInput: input.length,
    totalDeduped: rankedSources.length,
    duplicateCount: input.length - rankedSources.length,
    kbCount: kbSources.length,
    webCount: webSources.length,
    averageReliability,
    citationCandidateIds: assessments.slice(0, 8).map((item) => item.sourceId),
    assessments,
    conflicts: detectConflicts(rankedSources),
    gaps,
    summary: `Evaluated ${input.length} sources, kept ${rankedSources.length}, average reliability ${averageReliability}.`,
  };

  return { sources: rankedSources, evaluation };
}

function buildTaskProcessingPrompt(
  rootPrompt: string,
  task: ResearchTask,
  evaluation: SourceEvaluation | null
) {
  const evaluationText = evaluation
    ? [
        evaluation.summary,
        `Citation candidate IDs: ${evaluation.citationCandidateIds.join(", ") || "none"}`,
        `Potential conflicts: ${evaluation.conflicts.join(" | ") || "none"}`,
        `Evidence gaps: ${evaluation.gaps.join(" | ") || "none"}`,
      ].join("\n")
    : "No source evaluation available.";

  return [
    `Root user request: ${rootPrompt}`,
    "",
    `Current checklist item: ${task.title}`,
    `Task type: ${task.type}`,
    `Task detail: ${task.detail}`,
    `Acceptance criteria: ${task.acceptanceCriteria.join("; ")}`,
    "",
    "Use the retrieved sources to complete only this checklist item.",
    "Return concise findings that can be merged into the final report.",
    "",
    "Source evaluation context:",
    evaluationText,
  ].join("\n");
}

function buildFinalReportPrompt(state: ResearchStateValue) {
  const checklist = state.tasks
    .map((task, index) => {
      const result = state.taskResults.find((item) => item.taskId === task.id);
      return [
        `${index + 1}. ${task.title}`,
        `Detail: ${task.detail}`,
        `Acceptance: ${task.acceptanceCriteria.join("; ")}`,
        `Status: ${result ? "completed" : "not completed"}`,
        result ? `Result summary: ${result.insight.slice(0, 1200)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    state.prompt,
    "",
    "Plan & Execute checklist results:",
    checklist,
    "",
    "Write the final report by synthesizing the completed checklist items.",
    "Preserve uncertainty and evidence gaps when sources were weak.",
  ].join("\n");
}

export async function runResearchGraph(
  client: SSEClient,
  prompt: string
): Promise<ResearchGraphResult> {
  const graph = new StateGraph(ResearchState)
    .addNode("planner", async (state: ResearchStateValue) => {
      emitNodeStart(client, "planner", "Create an executable task checklist.");
      const tasks = await buildTasks(state.prompt);
      const planText = tasks
        .map(
          (task, index) =>
            `${index + 1}. [${task.type}] ${task.title}\n   ${task.detail}\n   Query: ${task.query}`
        )
        .join("\n");
      const planMessage = { id: uuid(), role: "agent" as const };

      startTextStream(client, planMessage, `Execution checklist:\n${planText}`);
      endTextStream(client, planMessage);
      emitNodeDone(client, "planner", { tasks });

      return { tasks, currentTaskIndex: 0 };
    })
    .addNode("approval", async (state: ResearchStateValue) => {
      emitNodeStart(client, "approval", "Check whether human approval is required.");
      if (!shouldRequestApproval(state.prompt)) {
        emitNodeDone(client, "approval", { required: false });
        return { aborted: false };
      }

      const approved = await maybeRequestApproval(
        client,
        "This run may perform higher-cost external retrieval. Continue?"
      );
      emitNodeDone(client, "approval", { required: true, approved });

      if (!approved) {
        sendMessage(client, {
          id: uuid(),
          type: "text",
          role: "system",
          content: "User rejected continuation.",
        });
      }

      return { aborted: !approved };
    })
    .addNode("selectTask", async (state: ResearchStateValue) => {
      const task = currentTask(state);
      if (!task) {
        emitNodeDone(client, "selectTask", {
          status: "all_tasks_complete",
          completed: state.taskResults.length,
        });
        return {};
      }

      emitNodeStart(
        client,
        "selectTask",
        `Execute checklist item ${state.currentTaskIndex + 1}/${state.tasks.length}: ${task.title}`
      );
      emitNodeDone(client, "selectTask", {
        taskId: task.id,
        title: task.title,
        type: task.type,
        query: task.query,
        acceptanceCriteria: task.acceptanceCriteria,
      });
      return {};
    })
    // 做双路并行检索
    .addNode("retrieveEvidence", async (state: ResearchStateValue) => {
      const task = currentTask(state);
      const query = task?.query ?? state.prompt;
      emitNodeStart(client, "retrieveEvidence", `Retrieve evidence for: ${task?.title ?? "task"}`);
      emitToolCall(client, "hybrid_retrieval", { taskId: task?.id, query });
      const [kbSources, webSources] = await Promise.all([
        searchKnowledgeBase(query),
        tavilySearch(query),
      ]);
      emitToolResult(client, "knowledge_base_search", {
        taskId: task?.id,
        total: kbSources.length,
        items: kbSources,
      });
      emitToolResult(client, "tavily_search", {
        taskId: task?.id,
        total: webSources.length,
        items: webSources,
      });
      emitNodeDone(client, "retrieveEvidence", {
        taskId: task?.id,
        knowledgeBase: kbSources.length,
        web: webSources.length,
      });
      return { kbSources, webSources };
    })
    // 评估消息源
    .addNode("sourceEvaluator", async (state: ResearchStateValue) => {
      const task = currentTask(state);
      emitNodeStart(client, "sourceEvaluator", `Evaluate sources for: ${task?.title ?? "task"}`);
      const { sources, evaluation } = evaluateSources(state.kbSources, state.webSources);
      emitNodeDone(client, "sourceEvaluator", {
        taskId: task?.id,
        totalInput: evaluation.totalInput,
        totalDeduped: evaluation.totalDeduped,
        duplicateCount: evaluation.duplicateCount,
        averageReliability: evaluation.averageReliability,
        citationCandidateIds: evaluation.citationCandidateIds,
        conflicts: evaluation.conflicts,
        gaps: evaluation.gaps,
      });

      return { sources, sourceEvaluation: evaluation };
    })
    .addNode("process", async (state: ResearchStateValue) => {
      const task = currentTask(state);
      if (!task) return {};

      emitNodeStart(client, "process", `Complete checklist item: ${task.title}`);
      const processingPrompt = buildTaskProcessingPrompt(
        state.prompt,
        task,
        state.sourceEvaluation
      );
      const process = await runInformationProcessing(client, processingPrompt, state.sources, {
        streamToUser: false,
      });
      const sourceIds = state.sources.map((source) => source.id);
      const taskResult: TaskResult = {
        taskId: task.id,
        title: task.title,
        insight: process.insights,
        sourceIds,
        evaluationSummary: state.sourceEvaluation?.summary ?? "No source evaluation available.",
      };

      const preview =
        process.insights.replace(/\s+/g, " ").trim().slice(0, 180) ||
        "Checklist item completed.";

      emitNodeDone(client, "process", {
        taskId: task.id,
        nextTaskIndex: state.currentTaskIndex + 1,
        insightLength: process.insights.length,
        sourceIds,
        preview,
      });

      return {
        taskResults: [taskResult],
        allSources: state.sources,
        currentTaskIndex: state.currentTaskIndex + 1,
      };
    })
    .addNode("report", async (state: ResearchStateValue) => {
      emitNodeStart(client, "report", "Generate final report from completed checklist.");
      const finalSources = dedupeSources(state.allSources);
      const report = await runReportGeneration(
        client,
        buildFinalReportPrompt(state),
        state.taskResults.map((item) => `## ${item.title}\n${item.insight}`).join("\n\n"),
        finalSources
      );
      emitNodeDone(client, "report", {
        markdownLength: report.markdown.length,
        tasksCompleted: state.taskResults.length,
        sources: finalSources.length,
      });
      return { reportMarkdown: report.markdown };
    })
    .addEdge(START, "planner")
    .addEdge("planner", "approval")
    .addConditionalEdges(
      "approval",
      (state: ResearchStateValue) => (state.aborted ? END : "selectTask"),
      { selectTask: "selectTask", [END]: END } as any
    )
    .addConditionalEdges(
      "selectTask",
      (state: ResearchStateValue) =>
        state.currentTaskIndex >= state.tasks.length
          ? "report"
          : "retrieveEvidence",
      { retrieveEvidence: "retrieveEvidence", report: "report" } as any
    )
    .addEdge("retrieveEvidence", "sourceEvaluator")
    .addEdge("sourceEvaluator", "process")
    .addEdge("process", "selectTask")
    .addEdge("report", END)
    .compile();

  const result = await graph.invoke({ prompt });
  return {
    reportMarkdown: result.reportMarkdown,
    aborted: result.aborted,
  };
}
