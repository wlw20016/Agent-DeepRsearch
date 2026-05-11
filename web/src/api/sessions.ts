import type { Message, Session } from "../types/messages";

const API_BASE = `${(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "")}`;

type SessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

type ApiError = { error?: string };

function getApiError(data: unknown, fallback: string) {
  return typeof data === "object" && data && "error" in data && typeof data.error === "string"
    ? data.error
    : fallback;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & ApiError;
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

export async function fetchSessions(): Promise<Session[]> {
  const data = await readJson<{ ok: true; sessions: SessionSummary[] } | ApiError>(
    await fetch(`${API_BASE}/api/sessions`)
  );

  if (!("ok" in data && data.ok)) {
    throw new Error(getApiError(data, "Failed to load sessions"));
  }

  return data.sessions.map((session) => ({ ...session, messages: [] }));
}

export async function createRemoteSession(session: Session): Promise<Session> {
  const data = await readJson<{ ok: true; session: SessionSummary } | ApiError>(
    await fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
      }),
    })
  );

  if (!("ok" in data && data.ok)) {
    throw new Error(getApiError(data, "Failed to create session"));
  }

  return { ...data.session, messages: session.messages };
}

export async function updateRemoteSessionTitle(sessionId: string, title: string) {
  const data = await readJson<{ ok: true; session: SessionSummary } | ApiError>(
    await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
  );

  if (!("ok" in data && data.ok)) {
    throw new Error(getApiError(data, "Failed to update session"));
  }

  return data.session;
}

export async function fetchSessionMessages(sessionId: string): Promise<Message[]> {
  const data = await readJson<{ ok: true; messages: Message[] } | ApiError>(
    await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=200`)
  );

  if (!("ok" in data && data.ok)) {
    throw new Error(getApiError(data, "Failed to load messages"));
  }

  return data.messages.map((message) =>
    message.type === "text" ? { ...message, streaming: false } : message
  );
}

export async function saveRemoteMessage(sessionId: string, message: Message) {
  const data = await readJson<{ ok: true; messages: Message[] } | ApiError>(
    await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    })
  );

  if (!("ok" in data && data.ok)) {
    throw new Error(getApiError(data, "Failed to save message"));
  }

  return data.messages[0];
}
