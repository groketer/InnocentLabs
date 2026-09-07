/**
 * MILESTONE 3U — product knowledge base.
 *
 * Storage and retrieval for uploaded product documents (a book, a spec
 * sheet, anything longer than fits in one prompt). Documents are chunked
 * on upload so a composer can search for and pull in just the passages
 * relevant to a specific prospect — the point being to actually reference
 * "certain aspects/principles" that fit a given prospect's situation,
 * not paste the whole document into every email regardless of relevance.
 *
 * RETRIEVAL APPROACH: keyword-overlap scoring, not embeddings. This is a
 * deliberate choice, not a shortcut taken because it's easier — for a
 * handful of documents per product and prompts built from real, specific
 * evidence (a prospect's actual business, actual evidence text), keyword
 * overlap against meaningful words finds genuinely relevant passages
 * without needing a vector database dependency. If the knowledge base
 * grows to many documents per product, revisiting this with real
 * embeddings would be the natural next step — not needed at today's scale.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

export interface ProductDocument {
  id: string;
  product_id: string;
  filename: string;
  char_count: number;
  uploaded_at: string;
}

const CHUNK_SIZE_CHARS = 3000; // roughly 500-700 words per chunk
const CHUNK_OVERLAP_CHARS = 300; // avoid severing a passage exactly at a chunk boundary

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }

  return chunks;
}

export async function addProductDocument(input: {
  product_id: string;
  filename: string;
  text: string;
}): Promise<ProductDocument> {
  const db = await getDb();
  const documentId = randomUUID();
  const chunks = chunkText(input.text);

  await db.execute({
    sql: `
      INSERT INTO product_documents (id, product_id, filename, char_count)
      VALUES (@id, @product_id, @filename, @char_count)
    `,
    args: {
      id: documentId,
      product_id: input.product_id,
      filename: input.filename,
      char_count: input.text.length,
    },
  });

  const statements = chunks.map((chunk, i) => ({
    sql: `
      INSERT INTO product_document_chunks (id, document_id, product_id, chunk_index, chunk_text)
      VALUES (@id, @document_id, @product_id, @chunk_index, @chunk_text)
    `,
    args: {
      id: randomUUID(),
      document_id: documentId,
      product_id: input.product_id,
      chunk_index: i,
      chunk_text: chunk,
    },
  }));

  if (statements.length > 0) {
    await db.batch(statements, "write");
  }

  return {
    id: documentId,
    product_id: input.product_id,
    filename: input.filename,
    char_count: input.text.length,
    uploaded_at: new Date().toISOString(),
  };
}

export async function listProductDocuments(productId: string): Promise<ProductDocument[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM product_documents WHERE product_id = ? ORDER BY uploaded_at DESC`,
    args: [productId],
  });
  return result.rows as unknown as ProductDocument[];
}

export async function deleteProductDocument(documentId: string): Promise<void> {
  const db = await getDb();
  // Chunks cascade-delete via the foreign key, but this driver's batch
  // wrapper doesn't guarantee ON DELETE CASCADE fires the same way across
  // both Neon HTTP and local Postgres test paths, so delete explicitly
  // rather than relying on it silently working.
  await db.execute({
    sql: `DELETE FROM product_document_chunks WHERE document_id = ?`,
    args: [documentId],
  });
  await db.execute({
    sql: `DELETE FROM product_documents WHERE id = ?`,
    args: [documentId],
  });
}

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","at","by",
  "from","is","are","was","were","be","been","being","this","that","these",
  "those","it","its","as","if","then","than","so","not","no","can","could",
  "will","would","should","may","might","must","have","has","had","do","does",
  "did","i","you","he","she","we","they","them","their","our","your","his",
  "her","what","which","who","whom","about","into","over","after","before",
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

export interface KnowledgeSearchResult {
  chunk_text: string;
  filename: string;
  score: number;
}

/**
 * Finds the passages across a product's uploaded documents most relevant
 * to the given query (built from a specific prospect's real context —
 * their business, their evidence, their fit_reason). Scored by
 * significant-word overlap; returns the top matches only, since the
 * point is picking what's actually relevant to THIS prospect, not
 * returning everything.
 */
export async function searchProductKnowledge(
  productId: string,
  query: string,
  limit = 3
): Promise<KnowledgeSearchResult[]> {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      SELECT c.chunk_text, d.filename
      FROM product_document_chunks c
      JOIN product_documents d ON d.id = c.document_id
      WHERE c.product_id = ?
    `,
    args: [productId],
  });

  const rows = result.rows as unknown as Array<{ chunk_text: string; filename: string }>;
  if (rows.length === 0) return [];

  const queryWords = new Set(significantWords(query));
  if (queryWords.size === 0) return [];

  const scored = rows.map((row) => {
    const chunkWords = significantWords(row.chunk_text);
    let score = 0;
    for (const w of chunkWords) {
      if (queryWords.has(w)) score++;
    }
    return { chunk_text: row.chunk_text, filename: row.filename, score };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
