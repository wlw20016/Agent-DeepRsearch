import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import { runRootAgent } from "./agents/root.js";
import { resolveApproval } from "./approval.js";
import { initSSE, sendDone, sendError } from "./sse.js";

export const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
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
  if (!prompt) {
    return res.status(400).json({ error: "missing prompt" });
  }

  const client = initSSE(res);
  try {
    await runRootAgent(client, prompt);
    sendDone(client);
  } catch (err: unknown) {
    console.error(err);
    const errorMessage = err instanceof Error ? err.message : "unknown server error";
    sendError(client, errorMessage);
  }
});
