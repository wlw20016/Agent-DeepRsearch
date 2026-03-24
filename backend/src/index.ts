import express from "express";
import cors from "cors";
import { config } from "./env.js";
import { initSSE, sendDone, sendError } from "./sse.js";
import { runRootAgent } from "./agents/root.js";
import { resolveApproval } from "./approval.js";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/hil", (req, res) => {
  const { actionId, decision } = req.body ?? {};
  if (!actionId || !decision) {
    return res.status(400).json({ error: "缺少 actionId 或 decision" });
  }
  resolveApproval(actionId, decision === "approve" ? "approved" : "rejected");
  res.json({ ok: true });
});

app.get("/api/chat", async (req, res) => {
  const prompt = (req.query.prompt as string) ?? "";
  if (!prompt) {
    return res.status(400).json({ error: "缺少 prompt" });
  }
  const client = initSSE(res);

  try {
    await runRootAgent(client, prompt);
    sendDone(client);
  } catch (err: any) {
    console.error(err);
    sendError(client, err?.message ?? "未知错误");
  }
});

app.listen(config.port, () => {
  console.log(`Agent backend listening on http://localhost:${config.port}`);
});
