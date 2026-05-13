export type MessageRole = "user" | "agent" | "system";

export type Message =
  | {
      id: string;
      type: "text";
      role: MessageRole;
      content: string;
      streaming?: boolean;
    }
  | {
      id: string;
      type: "subAgentCall";
      role: "agent";
      content: string;
      meta: {
        task: string;
        agent: string;
      };
    }
  | {
      id: string;
      type: "toolCall";
      role: "agent";
      content: string;
      meta: {
        tool: string;
        input: unknown;
      };
    }
  | {
      id: string;
      type: "toolResult";
      role: "agent";
      content: string;
      meta: {
        tool: string;
        result: unknown;
      };
    }
  | {
      id: string;
      type: "attachment";
      role: "agent";
      content: string;
      meta: {
        url: string;
        name: string;
      };
    }
  | {
      id: string;
      type: "artifact";
      role: "agent";
      content: string;
      meta: {
        artifact: VisualArtifact;
      };
    }
  | {
      id: string;
      type: "humanInput";
      role: "agent";
      content: string;
      meta: {
        actionId: string;
        reason: string;
      };
    };

export type SourceType = "web" | "kb" | "session";

export type RetrievedSource = {
  id: string;
  title: string;
  url?: string;
  content: string;
  sourceType: SourceType;
  score?: number;
  docId?: string;
  chunkId?: string;
};

export type ResearchContext = {
  prompt: string;
  sources: RetrievedSource[];
};

export type TavilyResult = RetrievedSource & {
  sourceType: "web";
  url: string;
};

export type VisualFact = {
  id: string;
  taskId: string;
  subject: string;
  metric: string;
  value?: number | string;
  unit?: string;
  category?: string;
  period?: string;
  dimension: string;
  sourceIds: string[];
  confidence: number;
  context: string;
};

export type VisualCandidate = {
  id: string;
  topic: string;
  artifactType: "chart" | "table";
  chartType?: "bar" | "line" | "pie" | "scatter";
  requiredDimensions: string[];
  reason: string;
};

export type ChartArtifactSpec = {
  chartType: "bar" | "line" | "pie" | "scatter";
  xField?: string;
  yField?: string;
  seriesField?: string;
  unit?: string;
  data: Array<Record<string, string | number | null>>;
};

export type TableArtifactSpec = {
  columns: string[];
  rows: Array<Array<string | number | null>>;
};

export type VisualArtifact = {
  id: string;
  type: "chart" | "table";
  title: string;
  description?: string;
  spec: ChartArtifactSpec | TableArtifactSpec;
  sourceIds: string[];
};
