import { ingestKnowledgeBase } from "./knowledge.js";

async function main() {
  const result = await ingestKnowledgeBase();
  console.log(`Ingested ${result.chunkCount} chunks from ${result.documentCount} knowledge files.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
