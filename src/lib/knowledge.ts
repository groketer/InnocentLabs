/**
 * Knowledge loader
 * -----------------
 * Milestone 1 uses a very simple approach: read a fixed set of markdown
 * files from the /knowledge directory at request time and concatenate
 * them into a single "knowledge base" string that gets attached to the
 * agent's context.
 *
 * This is intentionally NOT a vector database or RAG pipeline. There is
 * no chunking, no embeddings, and no similarity search. For the current
 * size of the knowledge base, that would be over-engineering.
 *
 * EXTENSION POINT (future milestone):
 * When the knowledge base grows, replace the body of `loadKnowledgeBase`
 * with a call to a PostgreSQL / vector-search backed retriever. Nothing
 * outside this file needs to change — callers only depend on the
 * `loadKnowledgeBase()` function signature below.
 */

import fs from "fs/promises";
import path from "path";

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");

const KNOWLEDGE_FILES = [
  "innocent.md",
  "innocent-labs.md",
  "products.md",
] as const;

export interface KnowledgeDocument {
  /** File name, e.g. "innocent.md" */
  name: string;
  /** Raw markdown contents */
  content: string;
}

/**
 * Reads every known knowledge file from disk and returns them individually.
 * Missing files are skipped (with a console warning) rather than crashing
 * the whole request — this keeps the app resilient during development.
 */
export async function loadKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  const documents: KnowledgeDocument[] = [];

  for (const fileName of KNOWLEDGE_FILES) {
    try {
      const filePath = path.join(KNOWLEDGE_DIR, fileName);
      const content = await fs.readFile(filePath, "utf-8");
      documents.push({ name: fileName, content: content.trim() });
    } catch (error) {
      console.warn(
        `[knowledge] Could not read knowledge file "${fileName}". It will be skipped.`,
        error
      );
    }
  }

  return documents;
}

/**
 * Convenience helper that returns the whole knowledge base as one string,
 * ready to be inserted into the agent's system/context input. Each source
 * document is clearly labelled so the model can distinguish between them.
 */
export async function loadKnowledgeBase(): Promise<string> {
  const documents = await loadKnowledgeDocuments();

  if (documents.length === 0) {
    return "No knowledge files were available for this request.";
  }

  return documents
    .map((doc) => `## Source: ${doc.name}\n\n${doc.content}`)
    .join("\n\n---\n\n");
}
