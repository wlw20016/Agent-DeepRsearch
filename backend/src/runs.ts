import type { Response } from "express";
import { mkdirSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { v4 as uuid } from "uuid";
import { runRootAgent } from "./agents/root.js";
import { SSEClient, SSEEventName, sendDone, sendError } from "./sse.js";
import { Message } from "./types.js";

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export type RunEvent = {
  seq: number;
  event: SSEEventName;
  data: Message | string;
  createdAt: number;
};

export type ResearchRun = {
  id: string;
  sessionId: string;
  prompt: string;
  status: RunStatus;
  nextSeq: number;
  subscribers: Set<Response>;
  abortController: AbortController;
  startedAt: number;
  completedAt?: number;
  error?: string;
};

type RunRow = {
  id: string;
  session_id: string;
  prompt: string;
  status: RunStatus;
  next_seq: number;
  started_at: number;
  completed_at: number | null;
  error: string | null;
};

type EventRow = {
  seq: number;
  event: SSEEventName;
  data: string;
  created_at: number;
};

const dataDir = path.resolve(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "runs.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS research_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    next_seq INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS run_events (
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, seq),
    FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_run_events_run_seq ON run_events(run_id, seq);

  UPDATE research_runs
  SET status = 'failed',
      completed_at = COALESCE(completed_at, unixepoch('now') * 1000),
      error = COALESCE(error, 'server restarted before run completed')
  WHERE status = 'running';
`);

const activeRuns = new Map<string, ResearchRun>();

const insertRunStmt = db.prepare(`
  INSERT INTO research_runs (id, session_id, prompt, status, next_seq, started_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getRunStmt = db.prepare("SELECT * FROM research_runs WHERE id = ?");
const updateRunStatusStmt = db.prepare(`
  UPDATE research_runs
  SET status = ?, completed_at = ?, error = ?
  WHERE id = ?
`);
const insertEventStmt = db.prepare(`
  INSERT INTO run_events (run_id, seq, event, data, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
const updateNextSeqStmt = db.prepare("UPDATE research_runs SET next_seq = ? WHERE id = ?");
const listEventsStmt = db.prepare(`
  SELECT seq, event, data, created_at
  FROM run_events
  WHERE run_id = ? AND seq > ?
  ORDER BY seq ASC
`);

function writeSSE(res: Response, event: SSEEventName | "run", data: unknown, id?: number) {
  if (id !== undefined) {
    res.write(`id: ${id}\n`);
  }
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function rowToRun(row: RunRow): ResearchRun {
  const active = activeRuns.get(row.id);
  if (active) return active;

  return {
    id: row.id,
    sessionId: row.session_id,
    prompt: row.prompt,
    status: row.status,
    nextSeq: row.next_seq,
    subscribers: new Set<Response>(),
    abortController: new AbortController(),
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
  };
}

function persistRun(run: ResearchRun) {
  insertRunStmt.run(run.id, run.sessionId, run.prompt, run.status, run.nextSeq, run.startedAt);
}

function persistRunStatus(run: ResearchRun) {
  updateRunStatusStmt.run(run.status, run.completedAt ?? null, run.error ?? null, run.id);
}

function listRunEvents(runId: string, since = 0): RunEvent[] {
  return (listEventsStmt.all(runId, since) as EventRow[]).map((row) => ({
    seq: row.seq,
    event: row.event,
    data: JSON.parse(row.data) as Message | string,
    createdAt: row.created_at,
  }));
}

function appendRunEvent(run: ResearchRun, event: SSEEventName, data: Message | string) {
  const item: RunEvent = {
    seq: run.nextSeq++,
    event,
    data,
    createdAt: Date.now(),
  };

  insertEventStmt.run(run.id, item.seq, item.event, JSON.stringify(item.data), item.createdAt);
  updateNextSeqStmt.run(run.nextSeq, run.id);

  for (const subscriber of run.subscribers) {
    writeSSE(subscriber, item.event, item.data, item.seq);
  }
}

function createRunClient(run: ResearchRun): SSEClient {
  return {
    closed: false,
    abortController: run.abortController,
    emit: (event, data) => appendRunEvent(run, event, data),
  };
}

async function executeRun(run: ResearchRun) {
  const client = createRunClient(run);

  try {
    await runRootAgent(client, run.prompt);
    if (run.status === "running") {
      run.status = "completed";
      run.completedAt = Date.now();
      persistRunStatus(run);
      sendDone(client);
    }
  } catch (error: unknown) {
    if (run.abortController.signal.aborted) {
      run.status = "cancelled";
      run.completedAt = Date.now();
      persistRunStatus(run);
      sendError(client, "run cancelled");
      return;
    }

    const errorMessage = error instanceof Error ? error.message : "unknown server error";
    run.status = "failed";
    run.error = errorMessage;
    run.completedAt = Date.now();
    persistRunStatus(run);
    console.error(error);
    sendError(client, errorMessage);
  }
}

export function createResearchRun(sessionId: string, prompt: string) {
  const run: ResearchRun = {
    id: uuid(),
    sessionId,
    prompt,
    status: "running",
    nextSeq: 1,
    subscribers: new Set<Response>(),
    abortController: new AbortController(),
    startedAt: Date.now(),
  };

  persistRun(run);
  activeRuns.set(run.id, run);
  void executeRun(run);
  return run;
}

export function getResearchRun(runId: string) {
  const active = activeRuns.get(runId);
  if (active) return active;

  const row = getRunStmt.get(runId) as RunRow | undefined;
  return row ? rowToRun(row) : undefined;
}

export function subscribeToRun(run: ResearchRun, res: Response, since = 0) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  writeSSE(res, "run", {
    runId: run.id,
    sessionId: run.sessionId,
    status: run.status,
    nextSeq: run.nextSeq,
  });

  for (const event of listRunEvents(run.id, since)) {
    writeSSE(res, event.event, event.data, event.seq);
  }

  if (run.status === "running") {
    run.subscribers.add(res);
  }

  res.on("close", () => {
    run.subscribers.delete(res);
  });
}

export function cancelResearchRun(runId: string) {
  const run = getResearchRun(runId);
  if (!run || run.status !== "running") return run;

  run.status = "cancelled";
  run.completedAt = Date.now();
  persistRunStatus(run);
  run.abortController.abort();
  return run;
}
