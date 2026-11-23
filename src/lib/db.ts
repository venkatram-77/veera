import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";
import type { Conversation, Message, User } from "./types";

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const connection = new DatabaseSync(config.dbPath);
  connection.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id);

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const devUser = connection
    .prepare("SELECT id FROM users WHERE id = ?")
    .get("dev") as { id: string } | undefined;

  if (!devUser) {
    connection
      .prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("dev", "dev@local", "Dev", "", new Date().toISOString());
  }

  instance = connection;
  return connection;
}

export const DEV_USER: User = { id: "dev", email: "dev@local", name: "Dev" };

export function listConversations(userId: string): Conversation[] {
  return db()
    .prepare(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC",
    )
    .all(userId) as Conversation[];
}

export function getConversation(userId: string, id: string): Conversation | undefined {
  return db()
    .prepare(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? AND id = ?",
    )
    .get(userId, id) as Conversation | undefined;
}

export function createConversation(userId: string, title = "New chat"): Conversation {
  const now = new Date().toISOString();
  const row: Conversation = {
    id: crypto.randomUUID(),
    title,
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(
      "INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(row.id, userId, row.title, now, now);
  return row;
}

export function touchConversation(id: string): void {
  db().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
}

export function renameConversation(userId: string, id: string, title: string): void {
  db()
    .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(title, new Date().toISOString(), id, userId);
}

export function deleteConversation(userId: string, id: string): void {
  db().prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId);
}

export function listMessages(conversationId: string, limit = 40): Message[] {
  const rows = db()
    .prepare(
      "SELECT id, role, content, tool_calls, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
    )
    .all(conversationId, limit) as Message[];
  return rows.reverse();
}

export function addMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  toolCalls?: unknown,
): Message {
  const row: Message = {
    id: crypto.randomUUID(),
    role,
    content,
    tool_calls: toolCalls ? JSON.stringify(toolCalls) : null,
    created_at: new Date().toISOString(),
  };
  db()
    .prepare(
      "INSERT INTO messages (id, conversation_id, role, content, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(row.id, conversationId, role, content, row.tool_calls, row.created_at);
  touchConversation(conversationId);
  return row;
}
