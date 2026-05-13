import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatOnce } from "../llm.js";
import {
  ChartArtifactSpec,
  RetrievedSource,
  TableArtifactSpec,
  VisualArtifact,
  VisualCandidate,
  VisualFact,
} from "../types.js";

type TaskLike = {
  id: string;
  title: string;
  detail: string;
  type: string;
};

type SourceEvaluationLike = {
  summary: string;
  conflicts: string[];
  gaps: string[];
  citationCandidateIds: string[];
} | null;

const MAX_FACTS_PER_TASK = 12;
const MAX_CANDIDATES = 8;
const MAX_ARTIFACTS = 6;
const MAX_SOURCE_CHARS = 1400;
const MAX_REPORT_CHARS = 16000;

function parseJsonObject<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (!objectMatch) return fallback;

    try {
      return JSON.parse(objectMatch[0]) as T;
    } catch {
      return fallback;
    }
  }
}

function normalizeConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, Number(number.toFixed(2))));
}

function sourceSummary(source: RetrievedSource, index: number) {
  const label = source.sourceType === "kb" ? `KB-${index + 1}` : `WEB-${index + 1}`;
  return {
    id: source.id,
    label,
    title: source.title,
    url: source.url,
    sourceType: source.sourceType,
    content: source.content.slice(0, MAX_SOURCE_CHARS),
  };
}

function cleanString(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeVisualFact(raw: any, taskId: string, index: number): VisualFact | null {
  const subject = cleanString(raw?.subject);
  const metric = cleanString(raw?.metric);
  const dimension = cleanString(raw?.dimension);

  if (!subject || !metric || !dimension) return null;

  const sourceIds = Array.isArray(raw?.sourceIds)
    ? raw.sourceIds.map(String).filter(Boolean)
    : Array.isArray(raw?.source_ids)
      ? raw.source_ids.map(String).filter(Boolean)
      : [];

  return {
    id: cleanString(raw?.id, `${taskId}-fact-${index + 1}`),
    taskId,
    subject,
    metric,
    value: raw?.value,
    unit: raw?.unit ? String(raw.unit) : undefined,
    category: raw?.category ? String(raw.category) : undefined,
    period: raw?.period ? String(raw.period) : undefined,
    dimension,
    sourceIds,
    confidence: normalizeConfidence(raw?.confidence),
    context: cleanString(raw?.context).slice(0, 500),
  };
}

function normalizeCandidate(raw: any, index: number): VisualCandidate | null {
  const topic = cleanString(raw?.topic);
  const artifactType = raw?.artifactType === "table" || raw?.artifact_type === "table" ? "table" : "chart";
  const chartType = ["bar", "line", "pie", "scatter"].includes(raw?.chartType)
    ? raw.chartType
    : ["bar", "line", "pie", "scatter"].includes(raw?.chart_type)
      ? raw.chart_type
      : undefined;
  const requiredDimensions = Array.isArray(raw?.requiredDimensions)
    ? raw.requiredDimensions.map(String).filter(Boolean)
    : Array.isArray(raw?.required_dimensions)
      ? raw.required_dimensions.map(String).filter(Boolean)
      : [];

  if (!topic || !requiredDimensions.length) return null;

  return {
    id: cleanString(raw?.id, `candidate-${index + 1}`),
    topic,
    artifactType,
    chartType: artifactType === "chart" ? chartType ?? "bar" : undefined,
    requiredDimensions,
    reason: cleanString(raw?.reason),
  };
}

function isChartSpec(value: any): value is ChartArtifactSpec {
  return (
    value &&
    ["bar", "line", "pie", "scatter"].includes(value.chartType) &&
    Array.isArray(value.data)
  );
}

function isTableSpec(value: any): value is TableArtifactSpec {
  return value && Array.isArray(value.columns) && Array.isArray(value.rows);
}

function normalizeArtifact(raw: any, index: number): VisualArtifact | null {
  const type = raw?.type === "table" ? "table" : "chart";
  const title = cleanString(raw?.title);
  const rawSpec = raw?.spec ?? {};
  const spec =
    type === "chart"
      ? {
          ...rawSpec,
          chartType: rawSpec.chartType ?? rawSpec.chart_type,
          xField: rawSpec.xField ?? rawSpec.x_field,
          yField: rawSpec.yField ?? rawSpec.y_field,
          seriesField: rawSpec.seriesField ?? rawSpec.series_field,
        }
      : rawSpec;

  if (!title) return null;
  if (type === "chart" && !isChartSpec(spec)) return null;
  if (type === "table" && !isTableSpec(spec)) return null;

  return {
    id: cleanString(raw?.id, `artifact-${index + 1}`),
    type,
    title,
    description: raw?.description ? String(raw.description) : undefined,
    spec,
    sourceIds: Array.isArray(raw?.sourceIds)
      ? raw.sourceIds.map(String).filter(Boolean)
      : Array.isArray(raw?.source_ids)
        ? raw.source_ids.map(String).filter(Boolean)
        : [],
  };
}

function normalizeComparableText(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function dimensionsMatch(candidateDimension: string, factDimension: string) {
  const left = normalizeComparableText(candidateDimension);
  const right = normalizeComparableText(factDimension);
  return left === right || left.includes(right) || right.includes(left);
}

function numericFactValue(value: VisualFact["value"]) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const normalized = value.replace(/,/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function factsForCandidate(candidate: VisualCandidate, facts: VisualFact[]) {
  const matched = facts.filter((fact) =>
    candidate.requiredDimensions.some((dimension) => dimensionsMatch(dimension, fact.dimension))
  );

  return matched.length ? matched : facts.filter((fact) => candidate.topic.includes(fact.subject));
}

function fallbackArtifactForCandidate(
  candidate: VisualCandidate,
  facts: VisualFact[],
  index: number
): VisualArtifact | null {
  const matchedFacts = factsForCandidate(candidate, facts)
    .filter((fact) => fact.confidence >= 0.35)
    .slice(0, 20);
  if (matchedFacts.length < 2) return null;

  const numericFacts = matchedFacts
    .map((fact) => ({ fact, value: numericFactValue(fact.value) }))
    .filter((item): item is { fact: VisualFact; value: number } => item.value !== null);

  const sourceIds = uniqueStrings(matchedFacts.flatMap((fact) => fact.sourceIds));

  if (candidate.artifactType === "chart" && numericFacts.length >= 2) {
    const firstUnit = numericFacts.find((item) => item.fact.unit)?.fact.unit;
    const chartType = candidate.chartType ?? "bar";
    const data = numericFacts.map(({ fact, value }) => ({
      subject: fact.subject,
      metric: fact.metric,
      value,
      unit: fact.unit ?? firstUnit ?? null,
      period: fact.period ?? null,
      category: fact.category ?? null,
    }));

    return {
      id: `fallback-artifact-${index + 1}`,
      type: "chart",
      title: candidate.topic,
      description: candidate.reason || "根据调研过程中抽取的结构化事实自动生成。",
      spec: {
        chartType,
        xField: "subject",
        yField: "value",
        seriesField: "metric",
        unit: firstUnit,
        data,
      },
      sourceIds,
    };
  }

  return {
    id: `fallback-artifact-${index + 1}`,
    type: "table",
    title: candidate.topic,
    description: candidate.reason || "根据调研过程中抽取的结构化事实自动生成。",
    spec: {
      columns: ["对象", "指标", "值", "单位", "时间", "说明"],
      rows: matchedFacts.map((fact) => [
        fact.subject,
        fact.metric,
        fact.value ?? "-",
        fact.unit ?? "-",
        fact.period ?? "-",
        fact.context || fact.category || "-",
      ]),
    },
    sourceIds,
  };
}

function fallbackVisualArtifacts(candidates: VisualCandidate[], facts: VisualFact[]) {
  const artifacts: VisualArtifact[] = [];
  const seenTopics = new Set<string>();

  for (const candidate of candidates) {
    if (seenTopics.has(candidate.topic)) continue;
    const artifact = fallbackArtifactForCandidate(candidate, facts, artifacts.length);
    if (!artifact) continue;

    artifacts.push(artifact);
    seenTopics.add(candidate.topic);
    if (artifacts.length >= MAX_ARTIFACTS) break;
  }

  return artifacts;
}

export async function extractVisualFacts(input: {
  task: TaskLike;
  insight: string;
  sources: RetrievedSource[];
  sourceEvaluation: SourceEvaluationLike;
  signal?: AbortSignal;
}): Promise<VisualFact[]> {
  const sources = input.sources.map(sourceSummary);
  const messages = [
    new SystemMessage(
      [
        "You extract visualization-ready facts from research task results.",
        "Return only JSON: {\"facts\": VisualFact[]}.",
        "A VisualFact must have subject, metric, dimension, sourceIds, confidence, and context.",
        "Use value only when the value is explicitly supported. It can be number or string.",
        "Do not invent facts. Return an empty array when there is not enough comparable data.",
        `Return at most ${MAX_FACTS_PER_TASK} facts.`,
      ].join("\n")
    ),
    new HumanMessage(
      JSON.stringify({
        task: input.task,
        insight: input.insight.slice(0, 5000),
        sourceEvaluation: input.sourceEvaluation,
        sources,
      })
    ),
  ];

  const response = await chatOnce(messages, input.signal);
  const parsed = parseJsonObject<{ facts?: any[] }>(response, { facts: [] });
  return (parsed.facts ?? [])
    .map((item, index) => normalizeVisualFact(item, input.task.id, index))
    .filter((item): item is VisualFact => Boolean(item))
    .slice(0, MAX_FACTS_PER_TASK);
}

export async function extractVisualCandidates(input: {
  prompt: string;
  reportMarkdown: string;
  visualFacts: VisualFact[];
  sourceEvaluation: SourceEvaluationLike;
  signal?: AbortSignal;
}): Promise<VisualCandidate[]> {
  if (!input.visualFacts.length) return [];

  const messages = [
    new SystemMessage(
      [
        "You identify where a final research report should include charts or comparison tables.",
        "Return only JSON: {\"candidates\": VisualCandidate[]}.",
        "Each candidate must include topic, artifactType, chartType when artifactType is chart, requiredDimensions, and reason.",
        "Only request dimensions that exist in the provided visualFacts.",
        "Prefer tables for qualitative comparisons and bar/line charts for comparable numeric data.",
        `Return at most ${MAX_CANDIDATES} candidates.`,
      ].join("\n")
    ),
    new HumanMessage(
      JSON.stringify({
        prompt: input.prompt,
        reportMarkdown: input.reportMarkdown.slice(0, MAX_REPORT_CHARS),
        availableDimensions: [...new Set(input.visualFacts.map((fact) => fact.dimension))],
        visualFacts: input.visualFacts,
        sourceEvaluation: input.sourceEvaluation,
      })
    ),
  ];

  const response = await chatOnce(messages, input.signal);
  const parsed = parseJsonObject<{ candidates?: any[] }>(response, { candidates: [] });
  return (parsed.candidates ?? [])
    .map(normalizeCandidate)
    .filter((item): item is VisualCandidate => Boolean(item))
    .slice(0, MAX_CANDIDATES);
}

export async function planVisualArtifacts(input: {
  candidates: VisualCandidate[];
  visualFacts: VisualFact[];
  signal?: AbortSignal;
}): Promise<VisualArtifact[]> {
  if (!input.candidates.length || !input.visualFacts.length) return [];

  const messages = [
    new SystemMessage(
      [
        "You convert visualization candidates and verified facts into frontend-renderable artifacts.",
        "Return only JSON: {\"artifacts\": VisualArtifact[]}.",
        "For chart artifacts, spec must include chartType, xField, yField, optional seriesField, optional unit, and data.",
        "For table artifacts, spec must include columns and rows.",
        "Use only the provided facts. Do not invent data points.",
        "Skip candidates without enough matching facts.",
        `Return at most ${MAX_ARTIFACTS} artifacts.`,
      ].join("\n")
    ),
    new HumanMessage(
      JSON.stringify({
        candidates: input.candidates,
        visualFacts: input.visualFacts,
      })
    ),
  ];

  const response = await chatOnce(messages, input.signal);
  const parsed = parseJsonObject<{ artifacts?: any[] }>(response, { artifacts: [] });
  const artifacts = (parsed.artifacts ?? [])
    .map(normalizeArtifact)
    .filter((item): item is VisualArtifact => Boolean(item))
    .slice(0, MAX_ARTIFACTS);

  return artifacts.length ? artifacts : fallbackVisualArtifacts(input.candidates, input.visualFacts);
}
