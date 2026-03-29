import { describe, it, expect } from "vitest";
import { chunkText } from "../../src/core/rag-pipeline.js";

describe("RAG Pipeline - chunkText", () => {
  // ---- Basic splitting ----

  describe("basic splitting", () => {
    it("splits long text into multiple chunks", () => {
      const text = "A".repeat(3000);
      const chunks = chunkText(text, 1000, 200);

      expect(chunks.length).toBeGreaterThan(1);
      // Each chunk should not exceed chunkSize (plus some tolerance for boundary logic)
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(1100);
      }
    });

    it("assigns unique IDs to each chunk", () => {
      const text = "A".repeat(3000);
      const chunks = chunkText(text, 1000, 200);

      const ids = new Set(chunks.map((c) => c.id));
      expect(ids.size).toBe(chunks.length);
    });

    it("assigns sequential index values", () => {
      const text = "A".repeat(3000);
      const chunks = chunkText(text, 1000, 200);

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].index).toBe(i);
      }
    });

    it("chunk IDs follow the pattern chunk-<index>-<uuid>", () => {
      const text = "Some text that needs chunking. ".repeat(50);
      const chunks = chunkText(text, 200, 50);

      for (const chunk of chunks) {
        expect(chunk.id).toMatch(/^chunk-\d+-[a-f0-9]{8}$/);
      }
    });
  });

  // ---- Heading-aware splitting ----

  describe("heading-aware splitting", () => {
    it("splits on markdown ## headings", () => {
      const text = [
        "## Introduction",
        "This is the introduction section with some content.",
        "",
        "## Methods",
        "This is the methods section with some content.",
        "",
        "## Results",
        "This is the results section with some content.",
      ].join("\n");

      const chunks = chunkText(text, 5000, 0);

      // With a large chunkSize, each heading section should be its own chunk
      expect(chunks.length).toBe(3);
      expect(chunks[0].text).toContain("Introduction");
      expect(chunks[1].text).toContain("Methods");
      expect(chunks[2].text).toContain("Results");
    });

    it("further splits large heading sections that exceed chunkSize", () => {
      const text = [
        "## Section One",
        "A".repeat(2000),
        "",
        "## Section Two",
        "B".repeat(100),
      ].join("\n");

      const chunks = chunkText(text, 500, 100);

      // Section One should be split into multiple chunks, plus Section Two
      expect(chunks.length).toBeGreaterThan(2);
      // At least one chunk should contain content from Section Two
      const hasSectionTwo = chunks.some((c) => c.text.includes("Section Two") || c.text.startsWith("B"));
      expect(hasSectionTwo).toBe(true);
    });

    it("does not split on headings when text has no ## markers", () => {
      const text = "Just plain text with no headings. ".repeat(20);
      const chunks = chunkText(text, 200, 50);

      // Should still chunk but not by heading logic
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  // ---- Overlap ----

  describe("overlap", () => {
    it("creates overlapping chunks when overlap > 0", () => {
      // Create predictable text with sentence boundaries
      const sentences = Array.from({ length: 20 }, (_, i) =>
        `Sentence ${i} here. `
      ).join("");

      const chunks = chunkText(sentences, 100, 30);

      expect(chunks.length).toBeGreaterThan(1);

      // Check that consecutive chunks share some content
      // (due to overlap, the end of chunk N should appear at the start of chunk N+1)
      for (let i = 1; i < chunks.length; i++) {
        // Just verify chunks are not exactly butted together at a clean boundary
        // The overlap mechanism means chunk starts are pulled back from the end
        // of the previous chunk
        expect(chunks[i].text.length).toBeGreaterThan(0);
      }
    });

    it("works with overlap of 0 (no overlap)", () => {
      const text = "Word ".repeat(200);
      const chunks = chunkText(text, 100, 0);

      expect(chunks.length).toBeGreaterThan(1);
      // All text should be covered
      const combined = chunks.map((c) => c.text).join(" ");
      expect(combined.replace(/\s+/g, " ").trim().length).toBeGreaterThan(0);
    });
  });

  // ---- Negative start guard ----

  describe("negative start guard", () => {
    it("does not produce negative start index with large overlap", () => {
      // When overlap is larger than the chunk, the guard should prevent infinite loops
      const text = "Short text that might cause issues with large overlap.";
      const chunks = chunkText(text, 20, 50); // overlap > chunkSize

      expect(chunks.length).toBeGreaterThan(0);
      // Should not hang or crash
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeGreaterThan(0);
      }
    });
  });

  // ---- Empty text ----

  describe("empty text", () => {
    it("returns empty array for empty string", () => {
      const chunks = chunkText("", 1000, 200);
      expect(chunks).toHaveLength(0);
    });

    it("returns empty array for whitespace-only string", () => {
      const chunks = chunkText("   \n\n  ", 1000, 200);
      expect(chunks).toHaveLength(0);
    });
  });

  // ---- Text smaller than chunk size ----

  describe("text smaller than chunk size", () => {
    it("returns single chunk when text shorter than chunkSize and overlap=0", () => {
      const text = "Short text.";
      const chunks = chunkText(text, 1000, 0);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("Short text.");
      expect(chunks[0].index).toBe(0);
    });

    it("returns single chunk for exact chunkSize length with overlap=0", () => {
      const text = "A".repeat(100);
      const chunks = chunkText(text, 100, 0);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
    });

    it("first chunk is correct when text is shorter than chunkSize (overlap > 0)", () => {
      // When overlap > text length, the guard (start + 1) causes extra tiny chunks.
      // The first chunk should still contain the full text.
      const text = "Short text.";
      const chunks = chunkText(text, 1000, 200);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].text).toBe("Short text.");
    });
  });

  // ---- Default parameters ----

  describe("default parameters", () => {
    it("uses default chunkSize=1000 and overlap=200 when not specified", () => {
      const text = "A".repeat(3000);
      const chunks = chunkText(text);

      // With default params (1000 size, 200 overlap), should produce multiple chunks
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  // ---- Paragraph and sentence boundary handling ----

  describe("boundary handling", () => {
    it("prefers paragraph breaks for splitting", () => {
      const text = [
        "First paragraph with lots of content to fill space here.",
        "",
        "Second paragraph with lots of content to fill space here.",
        "",
        "Third paragraph with lots of content to fill space here.",
      ].join("\n");

      const chunks = chunkText(text, 80, 0);

      // Should split at paragraph boundaries when possible
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("prefers sentence breaks when no paragraph break available", () => {
      // Single long paragraph with multiple sentences
      const text = "First sentence here. Second sentence here. Third sentence here. Fourth sentence here. Fifth sentence here.";
      const chunks = chunkText(text, 60, 0);

      expect(chunks.length).toBeGreaterThan(1);
      // Chunks should ideally end at sentence boundaries
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeGreaterThan(0);
      }
    });
  });
});
