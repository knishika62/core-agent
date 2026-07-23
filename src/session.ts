import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Message } from "./types.js";

const SESSIONS_DIR = path.join(process.cwd(), "sessions");

export interface SessionInfo {
  name: string;
  messageCount: number;
  updatedAt: Date;
}

function sessionFilePath(name: string): string {
  const safeName = path.basename(name);
  if (!safeName || safeName !== name) {
    throw new Error(`invalid session name: ${name}`);
  }
  return path.join(SESSIONS_DIR, `${safeName}.json`);
}

export async function saveSession(name: string, messages: Message[]): Promise<string> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const filePath = sessionFilePath(name);
  await writeFile(filePath, JSON.stringify(messages, null, 2), "utf-8");
  return filePath;
}

export async function loadSession(name: string): Promise<Message[]> {
  const filePath = sessionFilePath(name);
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as Message[];
}

export async function listSessions(): Promise<SessionInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }

  const sessions: SessionInfo[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const name = entry.slice(0, -".json".length);
    const filePath = path.join(SESSIONS_DIR, entry);
    try {
      const [raw, st] = await Promise.all([readFile(filePath, "utf-8"), stat(filePath)]);
      const messages = JSON.parse(raw) as Message[];
      sessions.push({ name, messageCount: messages.length, updatedAt: st.mtime });
    } catch {
      // skip unreadable/corrupt session files rather than failing the whole listing
    }
  }

  sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return sessions;
}
