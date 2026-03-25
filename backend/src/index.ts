import express from "express";
import cors from "cors";
import { config } from "./env.js";
import { initSSE, sendDone, sendError } from "./sse.js";
import { runRootAgent } from "./agents/root.js";
import { resolveApproval } from "./approval.js";
import { Request, Response } from "express";

const app = express();
app.use(cors({ origin: "*" })); //允许跨域
app.use(express.json({ limit: "1mb" })); //

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

// 将 app.get 彻底替换为 app.post
app.post("/api/chat", async (req, res) => {
  // 架构核心 3：从 req.body 中安全提取参数
  const prompt = req.body?.prompt ?? "";
  if (!prompt) {
    return res.status(400).json({ error: "缺少 prompt" });
  }
  const client = initSSE(res);
  try {
    await runRootAgent(client, prompt);
    sendDone(client);
  } catch (err: unknown) {
    console.error(err);
    // 严谨的类型推断，拒绝使用 any
    const errorMessage = err instanceof Error ? err.message : "未知系统错误";
    sendError(client, errorMessage);
  }
});

app.listen(config.port, () => {
  console.log(`Agent backend listening on http://localhost:${config.port}`);
});
