import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { db } from "./db";
import { embed } from "./ollama";

export type DocumentInfo = {
  id: string;
  name: string;
  created_at: string;
  chunks: number;
};

async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const extension = path.extname(filename).toLowerCase();

  if ([".txt", ".md", ".csv", ".json", ".log", ".py", ".js", ".ts"].includes(extension)) {
    return buffer.toString("utf8");
  }

  if (extension === ".pdf") {
    try {
      const module = await import("pdf-parse");
      const parse = (module.default ?? module) as unknown as (
        input: Buffer,
      ) => Promise<{ text: string }>;
      const result = await parse(buffer);
      return result.text;
    } catch (error) {
      throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  if (extension === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (extension === ".pptx") {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const slides: string[] = [];
    for (const name of Object.keys(zip.files)) {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
        const xml = await zip.files[name].async("string");
        slides.push(xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
      }
    }
    return slides.join("\n\n");
  }

  throw new Error(`Unsupported file type: ${extension || "(none)"}`);
}

export function chunkText(text: string, size = 900, overlap = 120): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(".", end);
      if (boundary > start + size / 2) end = boundary + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

function toBuffer(vector: number[]): Buffer {
  return Buffer.from(new Uint8Array(new Float32Array(vector).buffer));
}

function fromBuffer(value: unknown): Float32Array {
  if (value instanceof Uint8Array) {
    return new Float32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (Buffer.isBuffer(value)) {
    return new Float32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new Error("Stored embedding has an invalid format");
}

export async function ingestDocument(
  userId: string,
  filename: string,
  buffer: Buffer,
): Promise<DocumentInfo> {
  const text = await extractText(filename, buffer);
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("No readable text found in the document.");

  const vectors = await embed(chunks);
  const documentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const connection = db();
  connection
    .prepare("INSERT INTO documents (id, user_id, name, created_at) VALUES (?, ?, ?, ?)")
    .run(documentId, userId, path.basename(filename), now);

  const insert = connection.prepare(
    "INSERT INTO chunks (id, document_id, user_id, content, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  chunks.forEach((chunk, index) => {
    insert.run(crypto.randomUUID(), documentId, userId, chunk, toBuffer(vectors[index]), now);
  });

  return { id: documentId, name: path.basename(filename), created_at: now, chunks: chunks.length };
}

export function listDocuments(userId: string): DocumentInfo[] {
  const rows = db()
    .prepare(
      `SELECT d.id, d.name, d.created_at, COUNT(c.id) AS chunks
       FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
       WHERE d.user_id = ? GROUP BY d.id ORDER BY d.created_at DESC`,
    )
    .all(userId) as DocumentInfo[];
  return rows;
}

export function deleteDocument(userId: string, id: string): boolean {
  return db().prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export type RagHit = { content: string; source: string; score: number };

export async function searchDocuments(
  userId: string,
  query: string,
  topK = 4,
): Promise<RagHit[]> {
  const rows = db()
    .prepare(
      `SELECT c.content, c.embedding, d.name AS source
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.user_id = ?`,
    )
    .all(userId) as { content: string; embedding: unknown; source: string }[];
  if (!rows.length) return [];

  const [queryVector] = await embed([query]);
  const scored = rows.map((row) => {
    const vector = fromBuffer(row.embedding);
    let dot = 0;
    let norm = 0;
    let queryNorm = 0;
    for (let index = 0; index < vector.length; index += 1) {
      dot += vector[index] * queryVector[index];
      norm += vector[index] ** 2;
      queryNorm += queryVector[index] ** 2;
    }
    return {
      content: row.content,
      source: row.source,
      score: norm && queryNorm ? dot / (Math.sqrt(norm) * Math.sqrt(queryNorm)) : 0,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

export function ragAvailable(): boolean {
  return fs.existsSync(path.join(path.dirname(config.dbPath), "veera.db"));
}
