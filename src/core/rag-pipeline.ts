import type {
  RAGConfig,
  RAGIndexResult,
  RAGSearchResult,
  RetrievalChunk,
} from "../types/index.js";
import { runAgent } from "./agent-runner.js";
import { TraceEmitter } from "../trace/emitter.js";
import { randomUUID } from "node:crypto";

/**
 * RAG Pipeline
 *
 * Document chunking + Pinecone MCP integration.
 * Index: chunk text -> embed -> upsert via Pinecone MCP
 * Search: query -> embed -> search via Pinecone MCP -> return chunks
 *
 * Uses Claude as the orchestrator: the LLM decides how to chunk,
 * calls Pinecone MCP tools for upsert/search.
 */

// ─── Document Chunking ──────────────────────────────────

export function chunkText(
  text: string,
  chunkSize = 1000,
  overlap = 200,
): Array<{ id: string; text: string; index: number }> {
  const chunks: Array<{ id: string; text: string; index: number }> = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    // Find a natural break point (paragraph or sentence boundary)
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      const sentenceBreak = text.lastIndexOf(". ", end);
      if (paragraphBreak > start + chunkSize * 0.5) {
        end = paragraphBreak + 2;
      } else if (sentenceBreak > start + chunkSize * 0.5) {
        end = sentenceBreak + 2;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push({
        id: `chunk-${index}-${randomUUID().slice(0, 8)}`,
        text: chunk,
        index,
      });
      index++;
    }

    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

// ─── Index Documents via LLM + Pinecone MCP ─────────────

export async function indexDocuments(
  documents: Array<{ id: string; text: string; source: string }>,
  config: RAGConfig,
): Promise<RAGIndexResult> {
  const startTime = Date.now();
  const tracer = new TraceEmitter();
  let totalChunks = 0;
  let totalUpserted = 0;

  for (const doc of documents) {
    const chunks = chunkText(doc.text, config.chunkSize, config.chunkOverlap);
    totalChunks += chunks.length;

    // Build upsert prompt for LLM to call Pinecone MCP
    const records = chunks.map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      source: doc.source,
      documentId: doc.id,
      chunkIndex: chunk.index,
    }));

    const prompt = [
      `Upsert the following ${records.length} records to Pinecone index "${config.indexName}"`,
      config.namespace ? `namespace "${config.namespace}"` : "",
      ".",
      "",
      "Records (JSON):",
      JSON.stringify(records, null, 2),
      "",
      "Call the upsert-records tool with these records. Each record has id, text, source, documentId, chunkIndex fields.",
    ].join("\n");

    try {
      await runAgent({
        stepId: `rag-index-${doc.id}`,
        context: {
          state: "retrieve",
          identity: {
            role: "rag_indexer",
            constraints: ["Only call the upsert tool, no other output needed"],
          },
          tools: ["mcp:pinecone:upsert-records"],
        },
        input: prompt,
        tracer,
      });
      totalUpserted += chunks.length;
    } catch {
      // Partial indexing is acceptable -- log and continue
    }
  }

  return {
    indexName: config.indexName,
    documentsProcessed: documents.length,
    chunksCreated: totalChunks,
    chunksUpserted: totalUpserted,
    durationMs: Date.now() - startTime,
  };
}

// ─── Search via LLM + Pinecone MCP ─────────────────────

export async function searchDocuments(
  query: string,
  config: RAGConfig,
): Promise<RAGSearchResult> {
  const startTime = Date.now();
  const tracer = new TraceEmitter();

  const prompt = [
    `Search Pinecone index "${config.indexName}"`,
    config.namespace ? `namespace "${config.namespace}"` : "",
    `for the top ${config.topK} results matching this query:`,
    "",
    query,
    "",
    "Return the results as JSON array with fields: id, text, score, source.",
  ].join("\n");

  const result = await runAgent({
    stepId: "rag-search",
    context: {
      state: "retrieve",
      identity: {
        role: "rag_searcher",
        constraints: ["Return only the search results as JSON"],
      },
      tools: ["mcp:pinecone:search-records"],
    },
    input: prompt,
    tracer,
  });

  // Parse chunks from LLM output
  let chunks: RetrievalChunk[] = [];
  try {
    const stripped = result.text.replace(/```(?:json)?\s*\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(stripped);
    chunks = (Array.isArray(parsed) ? parsed : []).map((r: any) => ({
      chunkId: r.id ?? randomUUID().slice(0, 8),
      source: r.source ?? "pinecone",
      score: r.score ?? 0,
      text: r.text,
    }));
  } catch {
    // LLM output wasn't parseable JSON -- return empty
  }

  // Filter by score threshold
  if (config.scoreThreshold) {
    chunks = chunks.filter((c) => c.score >= (config.scoreThreshold ?? 0));
  }

  return {
    query,
    chunks,
    durationMs: Date.now() - startTime,
  };
}
