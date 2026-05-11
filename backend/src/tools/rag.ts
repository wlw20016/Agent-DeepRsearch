import { embedTexts, hasEmbeddingProvider } from "../embeddings.js";
import { config } from "../env.js";
import { queryChroma } from "../rag/chroma.js";
import { RetrievedSource } from "../types.js";

export async function searchKnowledgeBase(query: string): Promise<RetrievedSource[]> {
  if (!hasEmbeddingProvider()) {
    return [];
  }

  const [queryEmbedding] = await embedTexts([query]);
  const hits = await queryChroma(queryEmbedding, config.rag.topK);

  return hits
    .filter((item) => item.document.trim())
    .map((item) => ({
      id: item.id,
      title: String(item.metadata.title ?? item.metadata.docId ?? "Knowledge Base"),
      url: item.metadata.path ? String(item.metadata.path) : undefined,
      content: item.document,
      sourceType: "kb" as const,
      score: typeof item.distance === "number" ? 1 / (1 + item.distance) : undefined,
      docId: item.metadata.docId ? String(item.metadata.docId) : undefined,
      chunkId: item.metadata.chunkId ? String(item.metadata.chunkId) : undefined,
    }));
}
