import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { type Metadata } from "chromadb";
import { embedTexts, hasEmbeddingProvider } from "../embeddings.js";
import { config } from "../env.js";
import { deleteChromaByRelativePath, upsertChromaDocuments } from "./chroma.js";
import { splitTextIntoChunks } from "./splitter.js";

export type KnowledgeDocument = {
  absolutePath: string;
  relativePath: string;
  title: string;
  content: string;
};

export type KnowledgeFileItem = {
  name: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  updatedAt: number;
  supported: boolean;
  extension: string;
  tags: string[];
};

export type KnowledgeFileDetail = KnowledgeFileItem & {
  content: string;
};

export const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".html", ".htm", ".json"]);

export function isSupportedKnowledgeFile(fileName: string) {
  return SUPPORTED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function getKnowledgeDir() {
  return path.resolve(process.cwd(), config.rag.knowledgeDir);
}

export async function ensureKnowledgeDir() {
  const knowledgeDir = getKnowledgeDir();
  await fs.mkdir(knowledgeDir, { recursive: true });
  return knowledgeDir;
}

export function resolveKnowledgePath(relativePath: string) {
  const knowledgeDir = getKnowledgeDir();
  const resolved = path.resolve(knowledgeDir, relativePath);
  const normalizedBase = path.resolve(knowledgeDir) + path.sep;

  if (resolved !== path.resolve(knowledgeDir) && !resolved.startsWith(normalizedBase)) {
    throw new Error("invalid knowledge path");
  }

  return resolved;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(absolutePath);
      }
      return [absolutePath];
    })
  );

  return files.flat();
}

export async function loadKnowledgeDocuments(rootDir: string): Promise<KnowledgeDocument[]> {
  const files = await walk(rootDir);
  return loadKnowledgeDocumentsFromFiles(files, rootDir);
}

export async function listKnowledgeFiles(): Promise<KnowledgeFileItem[]> {
  const knowledgeDir = await ensureKnowledgeDir();
  const files = await walk(knowledgeDir);
  const items = await Promise.all(
    files.map(async (absolutePath) => {
      const stat = await fs.stat(absolutePath);
      const relativePath = path.relative(knowledgeDir, absolutePath);
      const extension = path.extname(absolutePath).toLowerCase();
      const baseTag = extension ? extension.replace(/^\./, "") : "unknown";
      return {
        name: path.basename(absolutePath),
        relativePath,
        absolutePath,
        size: stat.size,
        updatedAt: stat.mtimeMs,
        supported: isSupportedKnowledgeFile(absolutePath),
        extension,
        tags: [baseTag],
      };
    })
  );

  return items
    .filter((item) => item.supported)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getKnowledgeFileDetail(relativePath: string): Promise<KnowledgeFileDetail> {
  const absolutePath = resolveKnowledgePath(relativePath);
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error("knowledge file not found");
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const content = await fs.readFile(absolutePath, "utf8");

  return {
    name: path.basename(absolutePath),
    relativePath,
    absolutePath,
    size: stat.size,
    updatedAt: stat.mtimeMs,
    supported: isSupportedKnowledgeFile(absolutePath),
    extension,
    tags: [extension ? extension.replace(/^\./, "") : "unknown"],
    content,
  };
}

export async function loadKnowledgeDocumentsFromFiles(
  files: string[],
  rootDir = getKnowledgeDir()
): Promise<KnowledgeDocument[]> {
  const docs: KnowledgeDocument[] = [];

  for (const absolutePath of files) {
    const ext = path.extname(absolutePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      continue;
    }

    const content = await fs.readFile(absolutePath, "utf8");
    const relativePath = path.relative(rootDir, absolutePath);
    docs.push({
      absolutePath,
      relativePath,
      title: path.basename(absolutePath),
      content,
    });
  }

  return docs;
}

function buildChunkRecordId(docId: string, chunkId: string) {
  return `${docId}:${chunkId}`;
}

export type IngestResult = {
  documentCount: number;
  chunkCount: number;
  files: string[];
};

async function upsertKnowledgeDocuments(docs: KnowledgeDocument[]): Promise<IngestResult> {
  const records: Array<{
    id: string;
    document: string;
    metadata: Metadata;
    embedding: number[];
  }> = [];

  for (const doc of docs) {
    const docId = createHash("sha1").update(doc.relativePath).digest("hex");
    const chunks = splitTextIntoChunks(doc.content);
    if (!chunks.length) {
      continue;
    }

    const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
    chunks.forEach((chunk, index) => {
      records.push({
        id: buildChunkRecordId(docId, chunk.chunkId),
        document: chunk.content,
        embedding: embeddings[index],
        metadata: {
          docId,
          chunkId: chunk.chunkId,
          title: doc.title,
          path: doc.absolutePath,
          relativePath: doc.relativePath,
        },
      });
    });
  }

  if (records.length) {
    await upsertChromaDocuments(records);
  }

  return {
    documentCount: docs.length,
    chunkCount: records.length,
    files: docs.map((doc) => doc.relativePath),
  };
}

export async function ingestKnowledgeBase(): Promise<IngestResult> {
  if (!hasEmbeddingProvider()) {
    throw new Error("missing embedding provider config");
  }

  const knowledgeDir = await ensureKnowledgeDir();
  const docs = await loadKnowledgeDocuments(knowledgeDir);
  return upsertKnowledgeDocuments(docs);
}

export async function ingestKnowledgeFiles(files: string[]): Promise<IngestResult> {
  if (!hasEmbeddingProvider()) {
    throw new Error("missing embedding provider config");
  }

  const knowledgeDir = await ensureKnowledgeDir();
  const docs = await loadKnowledgeDocumentsFromFiles(files, knowledgeDir);
  return upsertKnowledgeDocuments(docs);
}

export async function ingestKnowledgeFileByRelativePath(relativePath: string): Promise<IngestResult> {
  const absolutePath = resolveKnowledgePath(relativePath);
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error("knowledge file not found");
  }

  return ingestKnowledgeFiles([absolutePath]);
}

export async function deleteKnowledgeFile(relativePath: string) {
  const absolutePath = resolveKnowledgePath(relativePath);
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error("knowledge file not found");
  }

  await deleteChromaByRelativePath(relativePath);
  await fs.unlink(absolutePath);

  return {
    deleted: relativePath,
  };
}
