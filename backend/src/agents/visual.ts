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
  const spec = raw?.spec;

  if (!title) return null;
  if (type === "chart" && !isChartSpec(spec)) return null;
  if (type === "table" && !isTableSpec(spec)) return null;

  return {
    id: cleanString(raw?.id, `artifact-${index + 1}`),
    type,
    title,
    description: raw?.description ? String(raw.description) : undefined,
    spec,
    sourceIds: Array.isArray(raw?.sourceIds) ? raw.sourceIds.map(String).filter(Boolean) : [],
  };
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
  return (parsed.artifacts ?? [])
    .map(normalizeArtifact)
    .filter((item): item is VisualArtifact => Boolean(item))
    .slice(0, MAX_ARTIFACTS);
}
