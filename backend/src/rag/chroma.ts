import { ChromaClient, IncludeEnum, type Collection, type Metadata } from "chromadb";
import { config } from "../env.js";

export type ChromaChunkRecord = {
  id: string;
  document: string;
  metadata: Metadata;
  embedding: number[];
};

let collectionPromise: Promise<Collection> | null = null;

async function getCollection() {
  if (!collectionPromise) {
    const client = new ChromaClient({ path: config.rag.chromaUrl });
    collectionPromise = client.getOrCreateCollection({
      name: config.rag.collectionName,
      metadata: {
        description: "Deep research knowledge base",
      },
    });
  }

  return collectionPromise;
}

export async function upsertChromaDocuments(records: ChromaChunkRecord[]) {
  if (!records.length) {
    return;
  }

  const collection = await getCollection();
  await collection.upsert({
    ids: records.map((item) => item.id),
    documents: records.map((item) => item.document),
    embeddings: records.map((item) => item.embedding),
    metadatas: records.map((item) => item.metadata),
  });
}

export type ChromaQueryHit = {
  id: string;
  document: string;
  metadata: Metadata;
  distance?: number;
};

export async function queryChroma(embedding: number[], topK: number): Promise<ChromaQueryHit[]> {
  const collection = await getCollection();
  const response = await collection.query({
    queryEmbeddings: [embedding],
    nResults: topK,
    include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances],
  });

  const ids = response.ids?.[0] ?? [];
  const documents = response.documents?.[0] ?? [];
  const metadatas = response.metadatas?.[0] ?? [];
  const distances = response.distances?.[0] ?? [];

  return ids.map((id: string, index: number) => ({
    id,
    document: documents[index] ?? "",
    metadata: (metadatas[index] ?? {}) as Metadata,
    distance: distances[index],
  }));
}

export async function deleteChromaByRelativePath(relativePath: string) {
  const collection = await getCollection();
  await collection.delete({
    where: {
      relativePath: {
        $eq: relativePath,
      },
    } as any,
  });
}
