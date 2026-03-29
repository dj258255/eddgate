import type {
  RAGConfig,
  RAGIndexResult,
  RAGSearchResult,
  RetrievalChunk,
} from "../types/index.js";
import { runAgent } from "./agent-runner.js";
import type { TraceEmitter } from "../trace/emitter.js";
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

// ---- constants --------------------------------------------------------

const HEADING_RE = /^## /m;
const APPROX_CHARS_PER_TOKEN = 4;
const TOKEN_WARN_THRESHOLD = 8192;

// ---- Document Chunking ------------------------------------------------

export function chunkText(
  text: string,
  chunkSize = 1000,
  overlap = 200,
): Array<{ id: string; text: string; index: number }> {
  const chunks: Array<{ id: string; text: string; index: number }> = [];

  // Phase 1 -- heading-aware splitting.
  // If the document contains markdown headings (## ), split on them first
  // so that each section stays self-contained. Sections that exceed
  // chunkSize are further split in Phase 2.
  let rawSections: string[];
  if (HEADING_RE.test(text)) {
    rawSections = [];
    const parts = text.split(/(?=^## )/m);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        rawSections.push(trimmed);
      }
    }
  } else {
    rawSections = [text];
  }

  // Phase 2 -- sub-split each section into chunks of at most chunkSize,
  // respecting paragraph / sentence boundaries and applying overlap.
  let index = 0;
  for (const section of rawSections) {
    let start = 0;
    while (start < section.length) {
      let end = Math.min(start + chunkSize, section.length);
      if (end < section.length) {
        const paragraphBreak = section.lastIndexOf("\n\n", end);
        const sentenceBreak = section.lastIndexOf(". ", end);
        if (paragraphBreak > start + chunkSize * 0.5) {
          end = paragraphBreak + 2;
        } else if (sentenceBreak > start + chunkSize * 0.5) {
          end = sentenceBreak + 2;
        }
      }

      const chunk = section.slice(start, end).trim();
      if (chunk.length > 0) {
        // Warn when a single chunk is very large in estimated tokens
        const estimatedTokens = Math.ceil(chunk.length / APPROX_CHARS_PER_TOKEN);
        if (estimatedTokens > TOKEN_WARN_THRESHOLD) {
          console.warn(
            `[rag-pipeline] chunk-${index} is ~${estimatedTokens} tokens -- ` +
            `consider reducing chunkSize (currently ${chunkSize})`,
          );
        }

        chunks.push({
          id: `chunk-${index}-${randomUUID().slice(0, 8)}`,
          text: chunk,
          index,
        });
        index++;
      }

      // Guard: ensure start never goes negative from a large overlap value
      start = Math.max(end - overlap, start + 1);
      if (start >= section.length) break;
    }
  }

  return chunks;
}

// ---- Reranking helpers ------------------------------------------------

/**
 * Sort results by score descending, then apply a diversity filter:
 * prefer at most one chunk per source. If fewer than topK results
 * remain after dedup, backfill with the remaining duplicates in
 * score order.
 */
function rerankAndDiversify(
  chunks: RetrievalChunk[],
  topK: number,
): RetrievalChunk[] {
  // Sort descending by score
  const sorted = [...chunks].sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const primary: RetrievalChunk[] = [];
  const backfill: RetrievalChunk[] = [];

  for (const chunk of sorted) {
    const key = chunk.source ?? chunk.chunkId;
    if (!seen.has(key)) {
      seen.add(key);
      primary.push(chunk);
    } else {
      backfill.push(chunk);
    }
  }

  const result = [...primary, ...backfill];
  return result.slice(0, topK);
}

// ---- Index Documents via LLM + Pinecone MCP ---------------------------

export async function indexDocuments(
  documents: Array<{ id: string; text: string; source: string }>,
  config: RAGConfig,
  tracer: TraceEmitter,
): Promise<RAGIndexResult> {
  const startTime = Date.now();
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

    const stepId = `rag-index-${doc.id}`;

    try {
      tracer.toolCall(stepId, {
        toolName: "pinecone:upsert-records",
        toolInput: { indexName: config.indexName, recordCount: records.length },
      });

      await runAgent({
        stepId,
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
    } catch (err: unknown) {
      // Partial indexing is acceptable -- log to tracer and continue
      const message =
        err instanceof Error ? err.message : String(err);
      tracer.error(stepId, `indexDocuments failed for doc ${doc.id}: ${message}`);
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

// ---- Search via LLM + Pinecone MCP ------------------------------------

export async function searchDocuments(
  query: string,
  config: RAGConfig,
  tracer: TraceEmitter,
): Promise<RAGSearchResult> {
  const startTime = Date.now();
  const stepId = "rag-search";

  const prompt = [
    `Search Pinecone index "${config.indexName}"`,
    config.namespace ? `namespace "${config.namespace}"` : "",
    `for the top ${config.topK} results matching this query:`,
    "",
    query,
    "",
    "Return the results as JSON array with fields: id, text, score, source.",
  ].join("\n");

  tracer.toolCall(stepId, {
    toolName: "pinecone:search-records",
    toolInput: { indexName: config.indexName, query, topK: config.topK },
  });

  const result = await runAgent({
    stepId,
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
    const stripped = result.text
      .replace(/```(?:json)?\s*\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(stripped);
    chunks = (Array.isArray(parsed) ? parsed : []).map((r: any) => ({
      chunkId: r.id ?? randomUUID().slice(0, 8),
      source: r.source ?? "pinecone",
      score: r.score ?? 0,
      text: r.text,
    }));
  } catch (err: unknown) {
    // LLM output was not parseable JSON -- log to tracer, return empty
    const message = err instanceof Error ? err.message : String(err);
    tracer.error(stepId, `Failed to parse search results: ${message}`);
  }

  // Filter by score threshold
  if (config.scoreThreshold) {
    chunks = chunks.filter((c) => c.score >= (config.scoreThreshold ?? 0));
  }

  // Rerank: sort by score descending + diversity filter
  chunks = rerankAndDiversify(chunks, config.topK);

  // Emit retrieval trace for observability
  tracer.retrieval(
    stepId,
    chunks.map((c) => ({
      chunkId: c.chunkId,
      source: c.source,
      score: c.score,
      text: c.text,
    })),
  );

  return {
    query,
    chunks,
    durationMs: Date.now() - startTime,
  };
}
