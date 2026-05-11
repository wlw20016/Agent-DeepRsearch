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

type PlanStep = {
  title: string;
  detail: string;
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
  plan: Annotation<PlanStep[]>({
    reducer: (_current, update) => update,
    default: () => [],
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
  sourceEvaluation: Annotation<SourceEvaluation | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  insights: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
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

async function buildPlan(prompt: string): Promise<PlanStep[]> {
  const response = await chatOnce([
    {
      role: "system",
      content:
        "You are a planning agent. Split the research task into 3-5 executable steps. Return a JSON array with title and detail fields.",
    } as any,
    { role: "human", content: prompt } as any,
  ]);

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((item) => ({
          title: item.title ?? "Step",
          detail: item.detail ?? "",
        }));
      }
    }
  } catch {
    /* ignore invalid JSON and fall back */
  }

  return [
    { title: "Understand the task", detail: "Clarify intent, scope, and deliverable." },
    { title: "Retrieve evidence", detail: "Search local knowledge and web sources in parallel." },
    { title: "Evaluate sources", detail: "Deduplicate, score, rank, and flag source risks." },
    { title: "Synthesize findings", detail: "Cross-check evidence and extract key insights." },
    { title: "Generate report", detail: "Produce a sourced Markdown research report." },
  ];
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

function evaluateSources(kbSources: RetrievedSource[], webSources: RetrievedSource[]) {
  const input = [...kbSources, ...webSources];
  const deduped = new Map<string, RetrievedSource>();

  for (const source of input) {
    const key = sourceKey(source);
    const existing = deduped.get(key);
    if (!existing || (source.score ?? 0) > (existing.score ?? 0)) {
      deduped.set(key, source);
    }
  }

  const sources = Array.from(deduped.values());
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

function buildProcessingPrompt(prompt: string, evaluation: SourceEvaluation | null) {
  if (!evaluation) return prompt;

  const assessmentText = evaluation.assessments
    .slice(0, 10)
    .map(
      (item) =>
        `- ${item.sourceId}: score=${item.reliabilityScore}, priority=${item.citationPriority}, reasons=${item.reasons.join("; ")}`
    )
    .join("\n");

  return [
    prompt,
    "",
    "Source evaluation context:",
    evaluation.summary,
    `Citation candidate IDs: ${evaluation.citationCandidateIds.join(", ") || "none"}`,
    `Potential conflicts: ${evaluation.conflicts.join(" | ") || "none"}`,
    `Evidence gaps: ${evaluation.gaps.join(" | ") || "none"}`,
    "Source assessments:",
    assessmentText || "- none",
  ].join("\n");
}

export async function runResearchGraph(
  client: SSEClient,
  prompt: string
): Promise<ResearchGraphResult> {
  const graph = new StateGraph(ResearchState)
    .addNode("planner", async (state: ResearchStateValue) => {
      emitNodeStart(client, "planner", "Create an executable research plan.");
      const plan = await buildPlan(state.prompt);
      const planText = plan
        .map((step, index) => `${index + 1}. ${step.title} - ${step.detail}`)
        .join("\n");
      const planMessage = { id: uuid(), role: "agent" as const };

      startTextStream(client, planMessage, `Execution plan:\n${planText}`);
      endTextStream(client, planMessage);
      emitNodeDone(client, "planner", { steps: plan.length });

      return { plan };
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
    .addNode("kbRetriever", async (state: ResearchStateValue) => {
      emitNodeStart(client, "kbRetriever", "Search local knowledge base.");
      emitToolCall(client, "knowledge_base_search", state.prompt);
      const kbSources = await searchKnowledgeBase(state.prompt);
      emitToolResult(client, "knowledge_base_search", {
        total: kbSources.length,
        items: kbSources,
      });
      emitNodeDone(client, "kbRetriever", { sources: kbSources.length });
      return { kbSources };
    })
    .addNode("webRetriever", async (state: ResearchStateValue) => {
      emitNodeStart(client, "webRetriever", "Search web evidence.");
      emitToolCall(client, "tavily_search", state.prompt);
      const webSources = await tavilySearch(state.prompt);
      emitToolResult(client, "tavily_search", {
        total: webSources.length,
        items: webSources,
      });
      emitNodeDone(client, "webRetriever", { sources: webSources.length });
      return { webSources };
    })
    .addNode("sourceEvaluator", async (state: ResearchStateValue) => {
      emitNodeStart(client, "sourceEvaluator", "Score, deduplicate, and audit sources.");
      const { sources, evaluation } = evaluateSources(state.kbSources, state.webSources);
      emitNodeDone(client, "sourceEvaluator", {
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
      emitNodeStart(client, "process", "Synthesize evidence into findings.");
      const processingPrompt = buildProcessingPrompt(state.prompt, state.sourceEvaluation);
      const process = await runInformationProcessing(client, processingPrompt, state.sources);
      emitNodeDone(client, "process", { insightLength: process.insights.length });
      return { insights: process.insights };
    })
    .addNode("report", async (state: ResearchStateValue) => {
      emitNodeStart(client, "report", "Generate the final Markdown report.");
      const report = await runReportGeneration(
        client,
        buildProcessingPrompt(state.prompt, state.sourceEvaluation),
        state.insights,
        state.sources
      );
      emitNodeDone(client, "report", { markdownLength: report.markdown.length });
      return { reportMarkdown: report.markdown };
    })
    .addEdge(START, "planner")
    .addEdge("planner", "approval")
    .addConditionalEdges(
      "approval",
      (state: ResearchStateValue) =>
        state.aborted ? END : ["kbRetriever", "webRetriever"],
      { kbRetriever: "kbRetriever", webRetriever: "webRetriever", [END]: END } as any
    )
    .addEdge(["kbRetriever", "webRetriever"], "sourceEvaluator")
    .addEdge("sourceEvaluator", "process")
    .addEdge("process", "report")
    .addEdge("report", END)
    .compile();

  const result = await graph.invoke({ prompt });
  return {
    reportMarkdown: result.reportMarkdown,
    aborted: result.aborted,
  };
}
