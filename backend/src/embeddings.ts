import axios from "axios";
import { config } from "./env.js";

type EmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

export function hasEmbeddingProvider() {
  return Boolean(config.embeddings.apiKey);
}

export async function embedTexts(input: string[]): Promise<number[][]> {
  if (!input.length) {
    return [];
  }

  if (!hasEmbeddingProvider()) {
    throw new Error("embedding provider is not configured");
  }

  const endpoint = `${config.embeddings.baseUrl.replace(/\/$/, "")}/embeddings`;
  const { data } = await axios.post<EmbeddingResponse>(
    endpoint,
    {
      model: config.embeddings.model,
      input,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.embeddings.apiKey}`,
      },
      timeout: 30_000,
    }
  );

  const vectors = (data.data ?? []).map((item) => item.embedding ?? []);
  if (vectors.length !== input.length || vectors.some((item) => !item.length)) {
    throw new Error("embedding provider returned invalid vectors");
  }

  return vectors;
}
