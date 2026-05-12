import { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointTuple,
  PendingWrite,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId,
} from "@langchain/langgraph-checkpoint";
import { mkdirSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import path from "path";

type CheckpointRow = {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
};

type WriteRow = {
  task_id: string;
  channel: string;
  value: Uint8Array;
};

function ensureBuffer(value: Uint8Array | string) {
  return typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
}

export class SqliteCheckpointSaver extends BaseCheckpointSaver {
  private db: DatabaseSync;

  constructor(dbPath = path.join(process.cwd(), "data", "langgraph-checkpoints.sqlite")) {
    super();
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        checkpoint BLOB NOT NULL,
        metadata BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );

      CREATE TABLE IF NOT EXISTS langgraph_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        value BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );

      CREATE INDEX IF NOT EXISTS idx_langgraph_checkpoints_thread
        ON langgraph_checkpoints(thread_id, checkpoint_ns, checkpoint_id);
    `);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return undefined;

    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const checkpointId = getCheckpointId(config);
    const row = checkpointId
      ? (this.db
          .prepare(
            `SELECT * FROM langgraph_checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`
          )
          .get(threadId, checkpointNs, checkpointId) as CheckpointRow | undefined)
      : (this.db
          .prepare(
            `SELECT * FROM langgraph_checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ?
             ORDER BY checkpoint_id DESC
             LIMIT 1`
          )
          .get(threadId, checkpointNs) as CheckpointRow | undefined);

    if (!row) return undefined;

    const writes = this.db
      .prepare(
        `SELECT task_id, channel, value FROM langgraph_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id ASC, idx ASC`
      )
      .all(row.thread_id, row.checkpoint_ns, row.checkpoint_id) as WriteRow[];

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint: await this.serde.loadsTyped("json", row.checkpoint),
      metadata: await this.serde.loadsTyped("json", row.metadata),
      pendingWrites: await Promise.all(
        writes.map(async (write) => [
          write.task_id,
          write.channel,
          await this.serde.loadsTyped("json", write.value),
        ])
      ),
    };

    if (row.parent_checkpoint_id) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }

    return tuple;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const rows = this.db
      .prepare(
        `SELECT * FROM langgraph_checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ?
         ORDER BY checkpoint_id DESC
         LIMIT ?`
      )
      .all(threadId, checkpointNs, options?.limit ?? 100) as CheckpointRow[];

    for (const row of rows) {
      if (options?.before?.configurable?.checkpoint_id) {
        if (row.checkpoint_id >= options.before.configurable.checkpoint_id) continue;
      }

      const tuple = await this.getTuple({
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      });
      if (!tuple) continue;

      if (options?.filter) {
        const metadata = (tuple.metadata ?? {}) as Record<string, unknown>;
        const matches = Object.entries(options.filter).every(([key, value]) => metadata[key] === value);
        if (!matches) continue;
      }

      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error("LangGraph checkpoint requires configurable.thread_id.");
    }

    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const parentCheckpointId = config.configurable?.checkpoint_id ?? null;
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const [[, serializedCheckpoint], [, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(preparedCheckpoint),
      this.serde.dumpsTyped(metadata),
    ]);

    this.db
      .prepare(
        `INSERT OR REPLACE INTO langgraph_checkpoints
          (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        threadId,
        checkpointNs,
        checkpoint.id,
        parentCheckpointId,
        ensureBuffer(serializedCheckpoint),
        ensureBuffer(serializedMetadata),
        Date.now()
      );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;
    if (!threadId || !checkpointId) {
      throw new Error("LangGraph writes require configurable.thread_id and checkpoint_id.");
    }

    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const statement = this.db.prepare(
      `INSERT OR IGNORE INTO langgraph_writes
        (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const [index, [channel, value]] of writes.entries()) {
      const idx = WRITES_IDX_MAP[channel] ?? index;
      const [, serializedValue] = await this.serde.dumpsTyped(value);
      statement.run(
        threadId,
        checkpointNs,
        checkpointId,
        taskId,
        idx,
        channel,
        ensureBuffer(serializedValue),
        Date.now()
      );
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db.prepare("DELETE FROM langgraph_writes WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM langgraph_checkpoints WHERE thread_id = ?").run(threadId);
  }
}

export const langgraphCheckpointer = new SqliteCheckpointSaver();
