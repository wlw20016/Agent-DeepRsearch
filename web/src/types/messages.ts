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
      meta: { task: string; agent: string };
    }
  | {
      id: string;
      type: "toolCall";
      role: "agent";
      content: string;
      meta: { tool: string; input: unknown };
    }
  | {
      id: string;
      type: "toolResult";
      role: "agent";
      content: string;
      meta: { tool: string; result: unknown };
    }
  | {
      id: string;
      type: "attachment";
      role: "agent";
      content: string;
      meta: { url: string; name: string };
    }
  | {
      id: string;
      type: "humanInput";
      role: "agent";
      content: string;
      meta: { actionId: string; reason: string };
    };

export type Session = {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
};

export type ConnectionStatus = "idle" | "streaming" | "reconnecting" | "error" | "paused";
