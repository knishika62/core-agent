#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { runTurn } from "./agent.js";
import { ToolContext, toolDefinitions } from "./tools/index.js";
import { cleanDroppedPath } from "./tools/pathUtils.js";
import type { ConfirmFn } from "./tools/context.js";
import type { Message } from "./types.js";
import { config, initConfig } from "./config.js";
import { loadEnvFile } from "./envLoader.js";
import { runEnvEditor } from "./envEditor.js";
import { loadSession, saveSession, listSessions, deleteSession } from "./session.js";
import { loadProjectInstructions, buildSystemPrompt } from "./projectInstructions.js";
import { closeBrowser } from "./tools/browser.js";
import { loadSkills } from "./skills.js";
import { loadHooksConfig } from "./hooks.js";
import { scheduleCronJobs } from "./cronDaemon.js";
import { loadCronConfig } from "./cronConfig.js";
import { baseSystemPrompt } from "./systemPrompt.js";
import { WEB_UI_HTML } from "./webUI.js";
import pkg from "../package.json" with { type: "json" };

interface SessionState {
  messages: Message[];
  ctx: ToolContext;
  autoMode: boolean;
  currentAbort: AbortController | null;
  pendingConfirms: Map<string, (approved: boolean, always: boolean) => void>;
  /** The in-flight POST /message response, if a turn is currently running —
   *  this is where confirm_request events and turn events get written.
   *  Only one turn per session at a time (see the 409 check in handleMessage). */
  activeRes: ServerResponse | null;
}

export interface WebServerOptions {
  cwd?: string;
  host?: string;
  port?: number;
}

function writeEvent(res: ServerResponse, evt: Record<string, unknown>): void {
  res.write(JSON.stringify(evt) + "\n");
}

/**
 * Resolves show_media's target path exactly the way toolShowMedia.ts does,
 * so both the live tool_call event and a reloaded session's history can
 * point an inline preview at /api/media without re-deriving the logic
 * twice (or drifting out of sync with it).
 */
function resolveShowMediaPath(cwd: string, argsJson: string): string | undefined {
  try {
    const rawPath = JSON.parse(argsJson)?.path;
    if (typeof rawPath !== "string") return undefined;
    return path.resolve(cwd, cleanDroppedPath(rawPath));
  } catch {
    return undefined;
  }
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Drag-and-drop counterpart of the TUI's drag&drop support (see
 * pathUtils.ts's cleanDroppedPath): a browser can't reveal a dropped file's
 * real filesystem path (a deliberate browser security restriction), so
 * there's no path text to just insert into the input the way a terminal
 * does. Instead the GUI uploads the file's bytes here, it gets saved under
 * the OS temp dir (same convention as systemPrompt.ts's scratch-file
 * guidance), and the resulting absolute path is what gets inserted into the
 * message text — from there it's an ordinary path the model can call
 * view_image/show_media on, same as a TUI-dropped path would be.
 */
async function handleUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const rawName = url.searchParams.get("filename") ?? "upload";
  const safeName = path.basename(rawName) || "upload";

  let body: Buffer;
  try {
    body = await readRawBody(req, MAX_UPLOAD_BYTES);
  } catch {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `file too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)` }));
    return;
  }

  const destPath = path.join(tmpdir(), `core-agent-upload-${randomUUID()}-${safeName}`);
  await writeFile(destPath, body);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ path: destPath }));
}

const MEDIA_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
};

/**
 * Streams a local file back over HTTP so show_media can render inline in
 * the session (image/video/audio tag) instead of only opening a native app
 * on whichever machine the server happens to be running on — the latter is
 * useless when the browser is on a different LAN machine than the server,
 * since that machine's desktop is never seen by the remote viewer. Gated
 * by config.guiInlineMedia (GUI_INLINE_MEDIA=0 to disable): this serves
 * arbitrary file contents to anyone who can reach the endpoint, which is
 * the same no-auth trust model as the rest of the GUI (bash/read already
 * let the model expose file contents to the client) but some deployments
 * may still want the explicit opt-out.
 */
async function handleMedia(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!config.guiInlineMedia) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "inline media is disabled (GUI_INLINE_MEDIA=0)" }));
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const rawPath = url.searchParams.get("path");
  if (!rawPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "path required" }));
    return;
  }

  let st;
  try {
    st = await stat(rawPath);
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (!st.isFile()) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not a file" }));
    return;
  }

  const mime = MEDIA_MIME[path.extname(rawPath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime, "Content-Length": String(st.size) });
  createReadStream(rawPath).pipe(res);
}

/**
 * Boots the shared harness state (mirrors cli.ts's main(): project
 * instructions, skills, hooks, cron) once, then serves the GUI + a small
 * JSON/ndjson API over plain node:http — no framework, the route surface is
 * small enough not to need one (matches the project's "core stays minimal"
 * stance). Returns the listening http.Server so tests can hit it on an
 * ephemeral port and callers can close it.
 */
export async function startWebServer(options: WebServerOptions = {}): Promise<Server> {
  const cwd = options.cwd ?? process.cwd();
  const projectInstructions = await loadProjectInstructions(cwd);
  const systemPrompt = buildSystemPrompt(baseSystemPrompt(), projectInstructions);
  const loadedSkills = await loadSkills(cwd);
  const hooksConfig = await loadHooksConfig(cwd);
  const hookCount = (hooksConfig.preToolUse?.length ?? 0) + (hooksConfig.postToolUse?.length ?? 0);
  const cronScheduled = await scheduleCronJobs(cwd, systemPrompt);

  const sessions = new Map<string, SessionState>();

  async function getOrCreateSession(name: string): Promise<SessionState> {
    const existing = sessions.get(name);
    if (existing) return existing;

    let messages: Message[];
    try {
      messages = await loadSession(name);
      // Re-synced on every (re)load, same as cli.ts: project instructions
      // may have changed since this session was last saved.
      messages[0] = { role: "system", content: systemPrompt };
    } catch {
      messages = [{ role: "system", content: systemPrompt }];
    }

    const session: SessionState = {
      messages,
      ctx: null as unknown as ToolContext, // set immediately below
      autoMode: false,
      currentAbort: null,
      pendingConfirms: new Map(),
      activeRes: null,
    };

    const confirm: ConfirmFn = async ({ tool, description, preview }) => {
      if (session.autoMode) return true;
      if (!session.activeRes) {
        // Shouldn't happen — confirm is only ever invoked from inside a
        // tool call, which only runs during an active POST /message turn.
        throw new Error("confirmation requested with no active response stream");
      }
      const id = randomUUID();
      writeEvent(session.activeRes, { type: "confirm_request", id, tool, description, preview });
      return new Promise<boolean>((resolve) => {
        session.pendingConfirms.set(id, (approved, always) => {
          if (always) session.autoMode = true;
          resolve(approved);
        });
      });
    };

    session.ctx = new ToolContext(cwd, confirm);
    // Only suppress the local open() when the inline viewer is actually
    // available to take its place (GUI_INLINE_MEDIA=0 means the GUI has no
    // other way to show media, so it should fall back to opening locally
    // same as the TUI, rather than showing nothing at all).
    session.ctx.skipMediaOpen = config.guiInlineMedia;
    sessions.set(name, session);
    return session;
  }

  async function handleStatus(res: ServerResponse): Promise<void> {
    // Re-read cron.json fresh on every call (mirrors loadHooksConfig's own
    // "small file, re-read every time" stance) rather than relying on the
    // cronJobs snapshot scheduleCronJobs() computed once at startup — that
    // snapshot never changed afterward, so the sidebar kept showing stale
    // (or missing) cron info until the whole server was restarted. This
    // only affects what's *displayed*; scheduleCronJobs() itself still only
    // registers jobs with node-cron once at startup (re-scheduling live
    // would mean tracking and un-registering each job's timer), so a job
    // added after startup shows up here but isn't actually firing yet —
    // still needs a restart for that part.
    const cronJobs = (await loadCronConfig(cwd)).jobs.map((j) => ({ name: j.name, schedule: j.schedule }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        version: pkg.version,
        model: config.main.model,
        baseUrl: config.main.baseUrl,
        projectInstructions: Boolean(projectInstructions),
        skills: loadedSkills,
        hookCount,
        cronScheduled,
        cronJobs,
        tools: toolDefinitions.map((t) => ({ name: t.name, description: t.description })),
      }),
    );
  }

  async function handleListSessions(res: ServerResponse): Promise<void> {
    const list = await listSessions();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(list));
  }

  async function handleGetSession(res: ServerResponse, name: string): Promise<void> {
    const session = await getOrCreateSession(name);
    // Enrich show_media tool_calls with a resolved mediaPath, same as the
    // live streaming path — otherwise a reloaded session would lose its
    // inline media previews (and the client has no cwd of its own to
    // resolve args.path against). Only when inline media is actually
    // enabled: /api/media 404s unconditionally when it isn't (see
    // handleMedia), so sending mediaPath anyway would just point the
    // client at broken <img>/<video>/<audio> tags — worse than the plain
    // "[tool call] show_media(...)" text it'd otherwise fall back to.
    const messages = session.messages.map((m) => {
      if (!m.toolCalls || !config.guiInlineMedia) return m;
      return {
        ...m,
        toolCalls: m.toolCalls.map((c) =>
          c.name === "show_media" ? { ...c, mediaPath: resolveShowMediaPath(session.ctx.cwd, c.arguments) } : c,
        ),
      };
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ messages, autoMode: session.autoMode }));
  }

  async function handleReset(res: ServerResponse, name: string): Promise<void> {
    const session = await getOrCreateSession(name);
    session.messages = [{ role: "system", content: systemPrompt }];
    await saveSession(name, session.messages);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  /**
   * Deletes a session's persisted file and drops its in-memory state. The
   * "default" session is the client's fallback when the sidebar list is
   * otherwise empty (see init()'s `sessions.length ? sessions[0].name :
   * "default"`), so deleting it would silently leave nothing for a client
   * to fall back to until someone happened to type "default" again —
   * recreating it immediately (and persisting the empty session right
   * away, not just lazily on next access) keeps that fallback always valid.
   */
  async function handleDeleteSession(res: ServerResponse, name: string): Promise<void> {
    await deleteSession(name);
    sessions.delete(name);
    if (name === "default") {
      const fresh = await getOrCreateSession("default");
      await saveSession("default", fresh.messages);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  async function handleAuto(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    const body = await readJsonBody(req);
    const session = await getOrCreateSession(name);
    session.autoMode = Boolean(body?.enabled);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ autoMode: session.autoMode }));
  }

  async function handleAbort(res: ServerResponse, name: string): Promise<void> {
    const session = sessions.get(name);
    session?.currentAbort?.abort();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  /**
   * GUI counterpart of cli.ts's "!<command>" passthrough: runs a shell
   * command directly, bypassing the model entirely. Same trust boundary as
   * the TUI (a human directly typed this, not something the model decided
   * to run), so — matching cli.ts's runShellCommand — this deliberately
   * skips the confirm gate and pre/post-tool-use hooks that gate the
   * model's own bash tool calls.
   *
   * "cd" is special-cased exactly like cli.ts's tryHandleCd, but simpler:
   * each session already owns its own ToolContext (ctx.cwd), so changing
   * directory here only ever touches *this* session's cwd — there's no
   * process-wide process.chdir() to reconcile across concurrently connected
   * clients the way a single-process TUI would need.
   */
  async function handleShell(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    const body = await readJsonBody(req);
    const command = String(body?.command ?? "").trim();
    if (!command) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "command must not be empty" }));
      return;
    }

    const session = await getOrCreateSession(name);
    res.writeHead(200, { "Content-Type": "application/json" });

    const cdMatch = command.match(/^cd(?:\s+(.*))?$/);
    if (cdMatch) {
      const target = cdMatch[1]?.trim();
      const resolved = path.resolve(session.ctx.cwd, target ? target : homedir());
      try {
        const st = await stat(resolved);
        if (!st.isDirectory()) throw new Error("not a directory");
        session.ctx.cwd = resolved;
        res.end(JSON.stringify({ output: "", exitCode: 0, cwd: session.ctx.cwd }));
      } catch (err: any) {
        res.end(JSON.stringify({ output: `cd: ${err.message}\n`, exitCode: 1, cwd: session.ctx.cwd }));
      }
      return;
    }

    try {
      const output = execSync(command, { cwd: session.ctx.cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
      res.end(JSON.stringify({ output, exitCode: 0, cwd: session.ctx.cwd }));
    } catch (err: any) {
      const output = String(err.stdout ?? "") + String(err.stderr ?? "");
      res.end(JSON.stringify({ output, exitCode: err.status ?? 1, cwd: session.ctx.cwd }));
    }
  }

  async function handleConfirm(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const body = await readJsonBody(req);
    const approved = Boolean(body?.approved);
    const always = Boolean(body?.always);
    for (const session of sessions.values()) {
      const resolve = session.pendingConfirms.get(id);
      if (resolve) {
        session.pendingConfirms.delete(id);
        resolve(approved, always);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "no such pending confirmation" }));
  }

  async function handleMessage(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    const body = await readJsonBody(req);
    const content = String(body?.content ?? "");
    if (!content.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "content must not be empty" }));
      return;
    }

    const session = await getOrCreateSession(name);
    if (session.activeRes) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "a turn is already in flight for this session" }));
      return;
    }

    session.messages.push({ role: "user", content });
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    session.activeRes = res;
    session.currentAbort = new AbortController();

    try {
      await runTurn(session.messages, session.ctx, {
        onTextDelta: (text) => writeEvent(res, { type: "text_delta", text }),
        onToolCall: (toolName, args) => {
          const mediaPath =
            toolName === "show_media" && config.guiInlineMedia ? resolveShowMediaPath(session.ctx.cwd, args) : undefined;
          writeEvent(res, { type: "tool_call", name: toolName, args, mediaPath });
        },
        onToolResult: (toolName, toolContent) => writeEvent(res, { type: "tool_result", name: toolName, content: toolContent }),
        onCompact: () => writeEvent(res, { type: "compact" }),
        onError: (err) => writeEvent(res, { type: "error", message: err instanceof Error ? err.message : String(err) }),
        abortSignal: session.currentAbort.signal,
      });
      if (session.currentAbort.signal.aborted) writeEvent(res, { type: "aborted" });
    } finally {
      session.currentAbort = null;
      session.activeRes = null;
      writeEvent(res, { type: "done" });
      res.end();
      await saveSession(name, session.messages).catch(() => {});
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;
      let m: RegExpMatchArray | null;

      if (req.method === "GET" && pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(WEB_UI_HTML);
        return;
      }
      if (req.method === "GET" && pathname === "/api/status") return await handleStatus(res);
      if (req.method === "GET" && pathname === "/api/sessions") return await handleListSessions(res);

      if (req.method === "GET" && (m = pathname.match(/^\/api\/session\/([^/]+)$/))) {
        return await handleGetSession(res, decodeURIComponent(m[1]));
      }
      if (req.method === "POST" && (m = pathname.match(/^\/api\/session\/([^/]+)\/reset$/))) {
        return await handleReset(res, decodeURIComponent(m[1]));
      }
      if (req.method === "DELETE" && (m = pathname.match(/^\/api\/session\/([^/]+)$/))) {
        return await handleDeleteSession(res, decodeURIComponent(m[1]));
      }
      if (req.method === "POST" && (m = pathname.match(/^\/api\/session\/([^/]+)\/auto$/))) {
        return await handleAuto(req, res, decodeURIComponent(m[1]));
      }
      if (req.method === "POST" && (m = pathname.match(/^\/api\/session\/([^/]+)\/message$/))) {
        return await handleMessage(req, res, decodeURIComponent(m[1]));
      }
      if (req.method === "POST" && (m = pathname.match(/^\/api\/session\/([^/]+)\/abort$/))) {
        return await handleAbort(res, decodeURIComponent(m[1]));
      }
      if (req.method === "POST" && (m = pathname.match(/^\/api\/session\/([^/]+)\/shell$/))) {
        return await handleShell(req, res, decodeURIComponent(m[1]));
      }
      if (req.method === "POST" && (m = pathname.match(/^\/api\/confirm\/([^/]+)$/))) {
        return await handleConfirm(req, res, decodeURIComponent(m[1]));
      }
      if (req.method === "POST" && pathname === "/api/upload") return await handleUpload(req, res);
      if (req.method === "GET" && pathname === "/api/media") return await handleMedia(req, res);

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (err: any) {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err?.message ?? String(err) }));
    }
  });

  // Node's http.Server defaults to a 5-minute requestTimeout, which forcibly
  // ends the connection out from under a long-running /message request —
  // e.g. a skill tool call that legitimately runs for several minutes (video
  // generation) — independent of anything in agent.ts or skills.ts. Disabled
  // here since a turn's actual ceiling is already governed by the tool's own
  // timeout (skills.ts's per-tool timeout_ms, or the LLM request itself).
  server.requestTimeout = 0;

  const host = options.host ?? config.guiHost;
  const port = options.port ?? config.guiPort;
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return server;
}

async function main(): Promise<void> {
  // The one CLI option the GUI binary accepts (see docs/gui.md) — a GUI-only
  // user has no reason to ever touch the TUI binary, so this needs its own
  // entry point rather than only living on cli.ts's --env. Checked before
  // the .env/config bootstrap for the same reason as cli.ts: this command's
  // job is creating/fixing .env, so it must work even when none exists yet.
  if (process.argv.slice(2).includes("--env")) {
    await runEnvEditor(process.cwd());
    return;
  }

  // Must happen before anything reads config.xxx — see cli.ts for the same
  // pattern (cwd/.env, falling back to ~/.core-agent/.env, first-run
  // bootstrap).
  loadEnvFile(process.cwd());
  initConfig();

  const server = await startWebServer();
  const addr = server.address();
  const shownPort = addr && typeof addr === "object" ? addr.port : config.guiPort;
  console.log(`core-agent GUI v${pkg.version} — model: ${config.main.model} @ ${config.main.baseUrl}`);
  console.log(`Listening on http://${config.guiHost}:${shownPort} (no auth — trusted networks only)`);
}

// Mirrors cli.ts's SIGINT handling: close any Chrome instance we launched
// (google_search/visit_page) instead of leaving an orphaned process and a
// stale profile lock behind. Unlike cli.ts, main() here resolves as soon as
// the server starts listening (it doesn't block on a REPL loop), so browser
// cleanup can't be tied to main()'s own completion — signals are the only hook.
//
// Unlike the TUI (an interactive REPL, always stopped with Ctrl-C/SIGINT),
// this is a long-running server process — realistically stopped with
// `kill`/`pkill` (SIGTERM by default) or a process manager (systemd, pm2,
// `docker stop`), none of which send SIGINT. Handling only SIGINT here left
// exactly that path leaking an orphaned Chrome process behind.
async function shutdown(): Promise<void> {
  await closeBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Only run main() when this file is the actual entry point (`tsx
// src/webServer.ts`, or the built/bundled equivalent) — not when
// startWebServer() is imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
