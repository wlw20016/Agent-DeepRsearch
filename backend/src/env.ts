import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT ? Number(process.env.PORT) : 3001,
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  },
  embeddings: {
    apiKey: process.env.EMBEDDING_API_KEY ?? "",
    baseUrl: process.env.EMBEDDING_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY ?? "",
  },
  rag: {
    chromaUrl: process.env.CHROMA_URL ?? "http://localhost:8000",
    collectionName: process.env.CHROMA_COLLECTION ?? "deep-research-kb",
    topK: process.env.RAG_TOP_K ? Number(process.env.RAG_TOP_K) : 6,
    knowledgeDir: process.env.RAG_KNOWLEDGE_DIR ?? "knowledge",
  },
};
