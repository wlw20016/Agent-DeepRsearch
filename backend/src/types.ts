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
      type: "humanInput";
      role: "agent";
      content: string;
      meta: {
        actionId: string;
        reason: string;
      };
    };

export type TavilyResult = {
  title: string;
  url: string;
  content: string;
};

export type ResearchContext = {
  prompt: string;
  sources: TavilyResult[];
};
