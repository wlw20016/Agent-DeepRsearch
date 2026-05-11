# RAG Implementation

This project now includes a first-pass RAG backend implementation with:

- Chroma as the vector store
- a standalone embedding provider via an OpenAI-compatible `/embeddings` API
- topK vector retrieval
- hybrid retrieval that merges `KB` and `WEB` sources

## Environment

Add the following variables in `backend/.env`:

```env
EMBEDDING_API_KEY=your_embedding_api_key
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small

CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=deep-research-kb
RAG_TOP_K=6
RAG_KNOWLEDGE_DIR=knowledge
```

## Knowledge Base Files

Place source files under `backend/knowledge`.

First version supported file types:

- `.md`
- `.txt`
- `.html`
- `.htm`
- `.json`

## Ingest

```bash
cd backend
npm run rag:ingest
```

The ingest script:

1. walks the knowledge directory
2. splits files into chunks
3. requests embeddings from the configured provider
4. upserts chunks into Chroma

## Runtime Flow

1. `infoGather` runs Tavily search and knowledge-base retrieval in parallel
2. `infoProcess` consumes a unified `RetrievedSource[]`
3. `report` produces KB and WEB citations separately

## Frontend Upload

The chat input now supports direct knowledge-file upload.

- endpoint: `POST /api/knowledge/upload`
- request: `multipart/form-data` with `files`
- behavior: save to `backend/knowledge`, then embed and upsert into Chroma immediately

On success, the current session shows a system message with the uploaded file list and chunk count.

## Knowledge Management

The app now includes a lightweight knowledge-base management panel.

- `GET /api/knowledge` lists uploaded files
- `GET /api/knowledge/detail?path=...` loads a single file preview
- `DELETE /api/knowledge?path=...` removes a file and its vector records
- `POST /api/knowledge/reingest` rebuilds the full knowledge base
- `POST /api/knowledge/reingest` with `{ "path": "..." }` rebuilds a single file

The frontend panel supports:

- filename/path search
- tag filtering based on file extension
- inline document preview

## New Backend Modules

- `backend/src/embeddings.ts`
- `backend/src/rag/chroma.ts`
- `backend/src/rag/splitter.ts`
- `backend/src/rag/ingest.ts`
- `backend/src/tools/rag.ts`

## Notes

- If the embedding provider is not configured, KB retrieval returns an empty list.
- If Chroma is unreachable, retrieval or ingest will fail at runtime.
- This first version uses vector-only retrieval and does not yet include reranking or BM25 hybrid search.
