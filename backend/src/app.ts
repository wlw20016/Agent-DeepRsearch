import cors from "cors";
import express from "express";
import multer from "multer";
import type { Request, Response } from "express";
import path from "path";
import { promises as fs } from "fs";
import { resolveApproval } from "./approval.js";
import {
  deleteKnowledgeFile,
  ensureKnowledgeDir,
  getKnowledgeFileDetail,
  ingestKnowledgeBase,
  ingestKnowledgeFileByRelativePath,
  ingestKnowledgeFiles,
  isSupportedKnowledgeFile,
  listKnowledgeFiles,
} from "./rag/knowledge.js";
import {
  cancelResearchRun,
  createResearchRun,
  getResearchRun,
  subscribeToRun,
} from "./runs.js";

export const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get("/api/knowledge", async (_req: Request, res: Response) => {
  try {
    const items = await listKnowledgeFiles();
    res.json({ ok: true, items });
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : "failed to list knowledge files";
    res.status(500).json({ error: errorMessage });
  }
});

app.get("/api/knowledge/detail", async (req: Request, res: Response) => {
  const relativePath = typeof req.query.path === "string" ? req.query.path : "";
  if (!relativePath) {
    return res.status(400).json({ error: "missing path" });
  }

  try {
    const item = await getKnowledgeFileDetail(relativePath);
    return res.json({ ok: true, item });
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : "failed to load knowledge file";
    return res.status(500).json({ error: errorMessage });
  }
});

app.post("/api/knowledge/upload", upload.array("files", 10), async (req: Request, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) {
      return res.status(400).json({ error: "missing files" });
    }

    const unsupported = files.filter((file) => !isSupportedKnowledgeFile(file.originalname));
    if (unsupported.length) {
      return res.status(400).json({
        error: "unsupported file type",
        unsupported: unsupported.map((file) => file.originalname),
        supported: [".md", ".txt", ".html", ".htm", ".json"],
      });
    }

    const knowledgeDir = await ensureKnowledgeDir();
    const savedPaths: string[] = [];

    for (const file of files) {
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext).replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
      const safeName = `${Date.now()}-${baseName || "document"}${ext.toLowerCase()}`;
      const absolutePath = path.join(knowledgeDir, safeName);
      await fs.writeFile(absolutePath, file.buffer);
      savedPaths.push(absolutePath);
    }

    const result = await ingestKnowledgeFiles(savedPaths);
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : "failed to upload knowledge files";
    return res.status(500).json({ error: errorMessage });
  }
});

app.delete("/api/knowledge", async (req: Request, res: Response) => {
  const relativePath =
    typeof req.query.path === "string" ? req.query.path : req.body?.path ?? "";

  if (!relativePath) {
    return res.status(400).json({ error: "missing path" });
  }

  try {
    const result = await deleteKnowledgeFile(relativePath);
    return res.json({ ok: true, ...result });
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : "failed to delete knowledge file";
    return res.status(500).json({ error: errorMessage });
  }
});

app.post("/api/knowledge/reingest", async (req: Request, res: Response) => {
  const relativePath = typeof req.body?.path === "string" ? req.body.path : "";

  try {
    const result = relativePath
      ? await ingestKnowledgeFileByRelativePath(relativePath)
      : await ingestKnowledgeBase();

    return res.json({ ok: true, ...result, scope: relativePath || "all" });
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : "failed to reingest knowledge";
    return res.status(500).json({ error: errorMessage });
  }
});

app.post("/api/hil", (req: Request, res: Response) => {
  const { actionId, decision } = req.body ?? {};
  if (!actionId || !decision) {
    return res.status(400).json({ error: "missing actionId or decision" });
  }

  resolveApproval(actionId, decision === "approve" ? "approved" : "rejected");
  res.json({ ok: true });
});

app.post("/api/chat", async (req: Request, res: Response) => {
  const prompt = req.body?.prompt ?? "";
  const sessionId = req.body?.sessionId ?? "default";
  const runId = typeof req.body?.runId === "string" ? req.body.runId : "";
  const since = Number(req.body?.since ?? 0);

  if (!prompt && !runId) {
    return res.status(400).json({ error: "missing prompt" });
  }

  const run = runId ? getResearchRun(runId) : createResearchRun(sessionId, prompt);
  if (!run) {
    return res.status(404).json({ error: "run not found" });
  }

  subscribeToRun(run, res, Number.isFinite(since) ? since : 0);
});

app.post("/api/runs/:runId/cancel", (req: Request, res: Response) => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const run = cancelResearchRun(runId);
  if (!run) {
    return res.status(404).json({ error: "run not found" });
  }

  return res.json({ ok: true, runId: run.id, status: run.status });
});
