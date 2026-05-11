export type MessageRole = "user" | "agent" | "system";
export type SyncStatus = "synced" | "pending" | "failed";

type MessageSyncState = {
  syncStatus?: SyncStatus;
};

export type Message =
  | {
      id: string;
      type: "text";
      role: MessageRole;
      content: string;
      streaming?: boolean;
    } & MessageSyncState
  | {
      id: string;
      type: "subAgentCall";
      role: "agent";
      content: string;
      meta: { task: string; agent: string };
    } & MessageSyncState
  | {
      id: string;
      type: "toolCall";
      role: "agent";
      content: string;
      meta: { tool: string; input: unknown };
    } & MessageSyncState
  | {
      id: string;
      type: "toolResult";
      role: "agent";
      content: string;
      meta: { tool: string; result: unknown };
    } & MessageSyncState
  | {
      id: string;
      type: "attachment";
      role: "agent";
      content: string;
      meta: { url: string; name: string };
    } & MessageSyncState
  | {
      id: string;
      type: "humanInput";
      role: "agent";
      content: string;
      meta: { actionId: string; reason: string };
    } & MessageSyncState;

export type Session = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  syncStatus?: SyncStatus;
  messages: Message[];
};

export type ConnectionStatus = "idle" | "streaming" | "reconnecting" | "error" | "paused";
