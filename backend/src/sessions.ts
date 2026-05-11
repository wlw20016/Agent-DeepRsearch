import { mkdirSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { v4 as uuid } from "uuid";
import type { Message } from "./types.js";

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: string;
  session_id: string;
  type: Message["type"];
  role: Message["role"];
  content: string;
  meta: string | null;
  created_at: number;
  updated_at: number;
};

type CreateSessionInput = {
  id?: string;
  title?: string;
  createdAt?: number;
};

const dataDir = path.resolve(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "sessions.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    meta TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at ASC);
`);

const listSessionsStmt = db.prepare(`
  SELECT id, title, created_at, updated_at
  FROM sessions
  WHERE deleted_at IS NULL
  ORDER BY updated_at DESC
`);

const getSessionStmt = db.prepare(`
  SELECT id, title, created_at, updated_at
  FROM sessions
  WHERE id = ? AND deleted_at IS NULL
`);

const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, title, created_at, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = CASE WHEN ? THEN excluded.title ELSE sessions.title END,
    updated_at = MAX(sessions.updated_at, excluded.updated_at),
    deleted_at = NULL
`);

const touchSessionStmt = db.prepare(`
  UPDATE sessions
  SET updated_at = ?
  WHERE id = ? AND deleted_at IS NULL
`);

const updateSessionTitleStmt = db.prepare(`
  UPDATE sessions
  SET title = ?, updated_at = ?
  WHERE id = ? AND deleted_at IS NULL
`);

const deleteSessionStmt = db.prepare(`
  UPDATE sessions
  SET deleted_at = ?, updated_at = ?
  WHERE id = ? AND deleted_at IS NULL
`);

const listMessagesStmt = db.prepare(`
  SELECT id, session_id, type, role, content, meta, created_at, updated_at
  FROM messages
  WHERE session_id = ? AND created_at < ?
  ORDER BY created_at DESC
  LIMIT ?
`);

const getMessageStmt = db.prepare(`
  SELECT id, session_id, type, role, content, meta, created_at, updated_at
  FROM messages
  WHERE id = ?
`);

const insertMessageStmt = db.prepare(`
  INSERT INTO messages (id, session_id, type, role, content, meta, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateMessageStmt = db.prepare(`
  UPDATE messages
  SET type = ?, role = ?, content = ?, meta = ?, updated_at = ?
  WHERE id = ?
`);

function rowToSession(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): Message {
  const meta = row.meta ? (JSON.parse(row.meta) as unknown) : undefined;
  const base = {
    id: row.id,
    type: row.type,
    role: row.role,
    content: row.content,
  };

  if (row.type === "text") {
    return { ...base, type: "text", role: row.role as Message["role"], streaming: false } as Message;
  }

  return { ...base, meta } as Message;
}

function getMessageMeta(message: Message) {
  return "meta" in message ? JSON.stringify(message.meta) : null;
}

export function ensureSession(input: CreateSessionInput = {}): SessionSummary {
  const now = Date.now();
  const id = input.id || uuid();
  const createdAt = input.createdAt || now;
  const title = input.title?.trim() || "新会话";
  const shouldUpdateTitle = input.title?.trim() ? 1 : 0;

  insertSessionStmt.run(id, title, createdAt, now, shouldUpdateTitle);
  const row = getSessionStmt.get(id) as SessionRow;
  return rowToSession(row);
}

export function listSessions(): SessionSummary[] {
  return (listSessionsStmt.all() as SessionRow[]).map(rowToSession);
}

export function updateSessionTitle(sessionId: string, title: string): SessionSummary | undefined {
  ensureSession({ id: sessionId, title });
  updateSessionTitleStmt.run(title.trim() || "新会话", Date.now(), sessionId);
  const row = getSessionStmt.get(sessionId) as SessionRow | undefined;
  return row ? rowToSession(row) : undefined;
}

export function deleteSession(sessionId: string) {
  const now = Date.now();
  deleteSessionStmt.run(now, now, sessionId);
}

export function listSessionMessages(sessionId: string, options: { before?: number; limit?: number } = {}) {
  const before = options.before ?? Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = listMessagesStmt.all(sessionId, before, limit) as MessageRow[];
  return rows.reverse().map(rowToMessage);
}

export function appendSessionMessage(sessionId: string, message: Message): Message {
  ensureSession({ id: sessionId });

  const now = Date.now();
  const existing = getMessageStmt.get(message.id) as MessageRow | undefined;
  const nextContent =
    existing && existing.type === "text" && message.type === "text" && message.streaming
      ? existing.content + message.content
      : message.content;

  if (existing) {
    updateMessageStmt.run(message.type, message.role, nextContent, getMessageMeta(message), now, message.id);
  } else {
    insertMessageStmt.run(
      message.id,
      sessionId,
      message.type,
      message.role,
      message.content,
      getMessageMeta(message),
      now,
      now
    );
  }

  touchSessionStmt.run(now, sessionId);
  const row = getMessageStmt.get(message.id) as MessageRow;
  return rowToMessage(row);
}

export function appendSessionMessages(sessionId: string, messages: Message[]) {
  return messages.map((message) => appendSessionMessage(sessionId, message));
}
