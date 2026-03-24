# AI 深度研究助手（LangChain 多 Agent + React 前端）

该项目包含 **LangChain 多智能体后端** 与 **React+Vite+TypeScript+Ant Design 前端**，实现 Plan & Execute 的研究流程、ReAct 搜索、流式输出、工具可视化、会话管理与 HIL 人工批准。

## 目录结构

- `backend/`：LangChain Agent 服务（DeepSeek LLM、Tavily 搜索工具、SSE 流式接口）
- `web/`：React 18 + Vite + TS + antd 前端
- `.gitignore`、`README.md`、示例环境变量

## 环境依赖

- Node.js 18+（已通过 `winget install OpenJS.NodeJS.LTS` 安装）
- Tavily API Key（用于网络搜索）
- DeepSeek API Key（用于 LLM 推理，代码已预留可兼容 OpenAI 接口的 Base URL）

## 后端（backend）

1. 安装依赖  
   ```bash
   cd backend
   npm install
   ```
2. 配置环境变量：复制 `.env.example` 为 `.env` 并填写
   ```env
   DEEPSEEK_API_KEY=你的DeepSeekKey
   DEEPSEEK_BASE_URL=https://api.deepseek.com
   DEEPSEEK_MODEL=deepseek-chat
   TAVILY_API_KEY=你的TavilyKey
   PORT=3001
   ```
   - 若未配置 Key，服务会自动进入演示模式，使用静态示例结果。
3. 开发模式（TS 直接运行）  
   ```bash
   npm run dev
   ```
4. 生产构建与启动  
   ```bash
   npm run build
   npm run start
   ```

### 后端实现要点

- **Root Agent（Plan & Execute）**：规划步骤 → 调用子 Agent → 汇总报告。
- **信息收集 Agent（ReAct）**：使用 Tavily `web_search` 工具，输出含 URL 的来源。
- **信息处理 Agent**：去重/提炼洞见。
- **报告生成 Agent**：Markdown 报告，引用来源编号；同时提供 data URL 下载附件消息。
- **流式输出**：SSE 接口 `GET /api/chat?prompt=...`，逐块推送消息；完成时触发 `done` 事件。
- **HIL 人工批准**：执行高成本动作前发送 `humanInput` 消息，前端按 `/api/hil` 返回批准/拒绝，服务器等待后继续。
- **健康检查**：`GET /api/health`

## 前端（web）

1. 安装依赖  
   ```bash
   cd web
   npm install
   ```
2. 配置环境变量：复制 `.env.example` 为 `.env`
   ```env
   VITE_API_BASE=http://localhost:3001
   ```
   默认已在 `vite.config.ts` 配置 `/api` 代理到 3001。
3. 开发启动  
   ```bash
   npm run dev
   ```
   访问 `http://localhost:5173`。
4. 构建预览  
   ```bash
   npm run build
   npm run preview
   ```

### 前端实现要点

- **消息可扩展渲染**：`Message` 可辨识联合类型（text/subAgentCall/toolCall/toolResult/attachment/humanInput）。
- **流式 Markdown 打字机效果**：后端拆分块发送，前端按 `id+streaming` 追加。
- **工具调用折叠卡片**：显示输入/输出原文。
- **SubAgent 调用卡片**：标明 Agent 与任务。
- **会话管理**：localStorage 持久化，左侧列表可新建/切换。
- **消息操作**：复制、编辑重发、重试。
- **断线重连**：SSE 自动指数退避重连，状态提示。
- **HIL 交互**：收到 `humanInput` 消息时展示 “批准/拒绝” 按钮，POST `/api/hil` 回传。
- **附件展示**：报告提供下载按钮（data URL）。
- **UI 设计**：定制字体/渐变背景/玻璃态侧栏，适配移动端。

## 运行顺序

1. 启动后端：`cd backend && npm run dev`
2. 启动前端：`cd web && npm run dev`
3. 浏览器打开前端，输入研究问题即可观察 Plan & Execute、工具调用与流式输出。

## 常见问题

- **无 API Key**：后端会使用示例数据返回，可先体验前端交互；配置 Key 后自动切换真实调用。
- **端口冲突**：修改 `.env` 中 `PORT` 或 `vite.config.ts` 的 dev server 端口。
- **CORS**：后端已允许 `*`，或使用 Vite 代理 `/api`。

## 参考规范

- LangChain 官方文档（Agent/Tool/Plan & Execute）
- Tavily API 用于网络搜索
- DeepSeek API（OpenAI 兼容接口）
