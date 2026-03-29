import { readFile, readdir } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import chalk from "chalk";
import { chunkText, indexDocuments, searchDocuments } from "../../core/rag-pipeline.js";
import type { RAGConfig } from "../../types/index.js";
import { TraceEmitter, createStdoutListener } from "../../trace/emitter.js";

interface RAGIndexOptions {
  dir: string;
  index: string;
  namespace?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

interface RAGSearchOptions {
  index: string;
  namespace?: string;
  topK?: number;
  threshold?: number;
}

export async function ragIndexCommand(options: RAGIndexOptions): Promise<void> {
  const dir = resolve(options.dir);
  console.log(chalk.bold(`\nRAG Index: ${options.index}\n`));
  console.log(chalk.dim(`  Source: ${dir}`));

  // Load all text files from directory
  let files: string[] = [];
  try {
    const entries = await readdir(dir);
    files = entries.filter((f) => [".txt", ".md", ".json", ".yaml", ".yml"].includes(extname(f)));
  } catch {
    console.error(chalk.red(`Directory not found: ${dir}`));
    return;
  }

  if (files.length === 0) {
    console.log(chalk.dim("  No text files found."));
    return;
  }

  console.log(chalk.dim(`  Files: ${files.length}`));

  const documents: Array<{ id: string; text: string; source: string }> = [];
  for (const file of files) {
    const text = await readFile(join(dir, file), "utf-8");
    documents.push({ id: file, text, source: file });
  }

  // Show chunking preview
  const totalChunks = documents.reduce((s, d) => {
    return s + chunkText(d.text, options.chunkSize ?? 1000, options.chunkOverlap ?? 200).length;
  }, 0);
  console.log(chalk.dim(`  Chunks: ${totalChunks} (size=${options.chunkSize ?? 1000}, overlap=${options.chunkOverlap ?? 200})`));
  console.log();

  const config: RAGConfig = {
    indexName: options.index,
    namespace: options.namespace,
    topK: 5,
    chunkSize: options.chunkSize ?? 1000,
    chunkOverlap: options.chunkOverlap ?? 200,
  };

  const tracer = new TraceEmitter();
  tracer.onEvent(createStdoutListener());
  const result = await indexDocuments(documents, config, tracer);

  console.log(chalk.bold("\n--- Index Results ---\n"));
  console.log(`  Documents: ${result.documentsProcessed}`);
  console.log(`  Chunks created: ${result.chunksCreated}`);
  console.log(`  Chunks upserted: ${result.chunksUpserted}`);
  console.log(`  Time: ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log();
}

export async function ragSearchCommand(
  query: string,
  options: RAGSearchOptions,
): Promise<void> {
  console.log(chalk.bold(`\nRAG Search: ${options.index}\n`));
  console.log(chalk.dim(`  Query: ${query}`));
  console.log(chalk.dim(`  Top K: ${options.topK ?? 5}`));
  if (options.threshold) console.log(chalk.dim(`  Threshold: ${options.threshold}`));
  console.log();

  const config: RAGConfig = {
    indexName: options.index,
    namespace: options.namespace,
    topK: options.topK ?? 5,
    scoreThreshold: options.threshold,
  };

  const tracer = new TraceEmitter();
  tracer.onEvent(createStdoutListener());
  const result = await searchDocuments(query, config, tracer);

  if (result.chunks.length === 0) {
    console.log(chalk.dim("  No results found."));
    return;
  }

  console.log(chalk.bold(`  ${result.chunks.length} results (${(result.durationMs / 1000).toFixed(1)}s):\n`));
  for (let i = 0; i < result.chunks.length; i++) {
    const chunk = result.chunks[i];
    const scoreColor = chunk.score >= 0.8 ? chalk.green : chunk.score >= 0.5 ? chalk.yellow : chalk.red;
    console.log(`  ${i + 1}. ${scoreColor(`[${chunk.score.toFixed(2)}]`)} ${chalk.cyan(chunk.source)}`);
    if (chunk.text) {
      const preview = chunk.text.length > 120 ? chunk.text.slice(0, 120) + "..." : chunk.text;
      console.log(chalk.dim(`     ${preview}`));
    }
    console.log();
  }
}
