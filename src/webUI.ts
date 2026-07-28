// Single-page GUI, served as one self-contained HTML document by webServer.ts.
// Kept as a plain template string (no separate asset files) so it stays
// trivially embeddable when this ever gets bundled/packaged into a binary,
// the same way the rest of core-agent's CLI-facing code has no external
// asset dependencies either.
export const WEB_UI_HTML = String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>core-agent</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #1a1a1a; --dim: #6b6b6b; --border: #d8d8d8;
    --bubble-user: #e8f0ff; --bubble-assistant: #f4f4f4; --accent: #2563eb;
    --error: #c0392b; --warn: #b8860b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121212; --fg: #cfcfcf; --dim: #9a9a9a; --border: #333333;
      --bubble-user: #1e2e42; --bubble-assistant: #232323; --accent: #5b9dff;
      --error: #ff6b5e; --warn: #e0b84a;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--bg); color: var(--fg); font-size: 14px;
  }
  #app { display: flex; height: 100vh; }
  aside {
    width: 260px; flex: none; border-right: 1px solid var(--border);
    display: flex; flex-direction: column; overflow-y: auto; padding: 12px;
    transition: width 0.12s ease;
  }
  aside.collapsed { width: 36px; overflow: hidden; padding: 12px 6px; }
  aside.collapsed #sidebarBody { display: none; }
  aside.collapsed .sidebar-header h1 { display: none; }
  .sidebar-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px; }
  .sidebar-header h1 { font-size: 15px; margin: 0; }
  #versionTag { font-size: 11px; font-weight: normal; color: var(--dim); margin-left: 6px; }
  #sidebarToggle { flex: none; padding: 4px 8px; }
  #status {
    font-size: 10px; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border);
    display: grid; grid-template-columns: auto 1fr; column-gap: 8px; row-gap: 3px; align-items: baseline;
  }
  #status dt { color: var(--dim); text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; }
  #status dd { margin: 0; word-break: break-all; }
  #sessions { flex: 1; overflow-y: auto; margin-bottom: 8px; }
  .session-item {
    padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
    display: flex; justify-content: space-between; gap: 6px; align-items: center;
  }
  .session-item:hover { background: var(--bubble-assistant); }
  .session-item.active { background: var(--accent); color: white; }
  .session-item .meta { color: var(--dim); font-size: 10px; }
  .session-item.active .meta { color: #1c2430; }
  .session-item .left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; overflow: hidden; }
  .session-item .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-delete {
    flex: none; border: none; background: none; color: var(--dim); font-size: 13px;
    line-height: 1; padding: 0 2px; cursor: pointer;
  }
  .session-delete:hover { color: var(--error); }
  .session-item.active .session-delete { color: #5a729c; }
  .session-item.active .session-delete:hover { color: #fff; }
  button {
    font-family: inherit; font-size: 13px; cursor: pointer; border: 1px solid var(--border);
    background: var(--bubble-assistant); color: var(--fg); border-radius: 4px; padding: 6px 10px;
  }
  button:hover { filter: brightness(1.1); }
  button:disabled { opacity: 0.5; cursor: default; }
  #newSessionBtn { font-size: 12px; }
  #toolsPanel { margin-top: 8px; color: var(--dim); font-size: 10px; }
  #toolsPanel ul { padding-left: 16px; margin: 6px 0; }
  main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
  header {
    padding: 6px 16px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px;
  }
  header[hidden] { display: none; }
  #headerToggle { flex: none; padding: 2px 7px; font-size: 11px; line-height: 1; }
  #headerFloatToggle {
    position: absolute; top: 8px; right: 12px; z-index: 5;
    padding: 3px 8px; font-size: 11px; line-height: 1; border-radius: 999px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.2);
  }
  #headerBody { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
  header #sessionName { font-weight: bold; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header label { color: var(--dim); font-size: 13px; display: flex; align-items: center; gap: 4px; }
  .font-size-control { display: flex; align-items: center; gap: 4px; color: var(--dim); }
  .font-size-control button { padding: 2px 7px; font-size: 11px; line-height: 1; }
  #fontSizeLabel { font-size: 11px; min-width: 30px; text-align: center; }
  #log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 80%; padding: 8px 12px; border-radius: 8px; word-wrap: break-word; }
  .msg.user { align-self: flex-end; background: var(--bubble-user); white-space: pre-wrap; }
  .msg.assistant { align-self: flex-start; background: var(--bubble-assistant); }
  .msg code { background: rgba(127,127,127,0.2); padding: 0 3px; border-radius: 3px; }
  .msg pre { background: rgba(127,127,127,0.15); padding: 8px; border-radius: 6px; overflow-x: auto; }
  .msg pre code { background: none; padding: 0; }
  .msg h1, .msg h2, .msg h3, .msg h4, .msg h5, .msg h6 { margin: 0.6em 0 0.3em; line-height: 1.25; }
  .msg h1 { font-size: 1.3em; }
  .msg h2 { font-size: 1.2em; }
  .msg h3 { font-size: 1.1em; }
  .msg h4, .msg h5, .msg h6 { font-size: 1em; }
  .msg p { margin: 0.4em 0; }
  .msg p:first-child, .msg > :first-child { margin-top: 0; }
  .msg p:last-child, .msg > :last-child { margin-bottom: 0; }
  .msg ul, .msg ol { margin: 0.4em 0; padding-left: 1.4em; }
  .msg li { margin: 0.15em 0; }
  .msg blockquote { margin: 0.4em 0; padding: 0.2em 0.8em; border-left: 3px solid var(--border); color: var(--dim); }
  .msg hr { border: none; border-top: 1px solid var(--border); margin: 0.6em 0; }
  .msg a { color: var(--accent); }
  .msg del { opacity: 0.6; }
  .msg table { border-collapse: collapse; margin: 0.4em 0; font-size: 0.95em; max-width: 100%; overflow-x: auto; display: block; }
  .msg th, .msg td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; }
  .msg th { background: rgba(127,127,127,0.15); }
  .sys-line { align-self: flex-start; color: var(--dim); font-size: 12px; white-space: pre-wrap; max-width: 90%; }
  .sys-line.error { color: var(--error); }
  .sys-line.warn { color: var(--warn); }
  .sys-line summary { cursor: pointer; }
  #log.hide-tool-lines .tool-line { display: none; }
  .media-preview {
    align-self: flex-start; display: flex; align-items: flex-start; gap: 8px;
    max-width: 90%;
  }
  .media-preview.file-kind {
    align-items: center; background: var(--bubble-assistant); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 10px; font-size: 13px;
  }
  .media-file-icon { font-size: 18px; line-height: 1; }
  .media-file-name { overflow-wrap: anywhere; }
  .media-preview img, .media-preview video {
    max-width: 100%; max-height: 50vh; border-radius: 8px; display: block;
  }
  .media-preview audio { max-width: 320px; }
  .media-download {
    flex: none; text-decoration: none; color: var(--dim); font-size: 14px;
    padding: 3px 6px; border: 1px solid var(--border); border-radius: 4px; line-height: 1;
  }
  .media-download:hover { color: var(--accent); border-color: var(--accent); }
  .media-wrap { position: relative; }
  .media-expand {
    position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.55); color: #fff;
    border: none; border-radius: 4px; padding: 2px 6px; font-size: 13px; cursor: pointer; line-height: 1;
  }
  .media-expand:hover { background: rgba(0,0,0,0.8); }
  .spinner {
    display: inline-block; width: 9px; height: 9px; margin-right: 6px; vertical-align: -1px;
    border: 2px solid var(--dim); border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  footer { border-top: 1px solid var(--border); padding: 10px 16px; display: flex; flex-direction: column; gap: 8px; }
  #inputRow { display: flex; gap: 8px; align-items: flex-end; }
  #attachments { display: flex; flex-wrap: wrap; gap: 6px; }
  .attachment-chip {
    display: flex; align-items: center; gap: 5px; max-width: 160px;
    background: var(--bubble-assistant); border: 1px solid var(--border); border-radius: 6px;
    padding: 3px 6px 3px 3px; font-size: 12px;
  }
  .attachment-chip img { width: 22px; height: 22px; object-fit: cover; border-radius: 4px; flex: none; }
  .attachment-chip .attachment-icon { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex: none; }
  .attachment-chip .attachment-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attachment-chip .attachment-remove {
    border: none; background: none; padding: 0 2px; font-size: 13px; line-height: 1; color: var(--dim); flex: none;
  }
  .attachment-chip .attachment-remove:hover { color: var(--error); }
  #input {
    flex: 1; font-family: inherit; font-size: 14px; padding: 8px; resize: vertical;
    background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px;
    min-height: 2.6em; max-height: 12em;
  }
  #modalOverlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex;
    align-items: center; justify-content: center; z-index: 10;
  }
  #modalOverlay[hidden] { display: none; }
  #lightboxOverlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex;
    align-items: center; justify-content: center; z-index: 20; cursor: zoom-out;
  }
  #lightboxOverlay[hidden] { display: none; }
  #lightboxContent img, #lightboxContent video {
    max-width: 92vw; max-height: 92vh; display: block; cursor: default;
  }
  #lightboxClose {
    position: fixed; top: 14px; right: 18px; z-index: 21; background: none; border: none;
    color: #fff; font-size: 28px; line-height: 1; cursor: pointer; padding: 4px 10px;
  }
  #lightboxClose:hover { color: var(--accent); }
  .media-preview img { cursor: zoom-in; }
  .modal-box {
    background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px;
    width: min(560px, 90vw); max-height: 80vh; display: flex; flex-direction: column; gap: 10px;
  }
  .modal-box h2 { margin: 0; font-size: 15px; overflow-wrap: anywhere; word-break: break-word; }
  .modal-box pre { background: var(--bubble-assistant); padding: 8px; border-radius: 6px; overflow: auto; max-height: 40vh; margin: 0; }
  #confirmPrompt { color: var(--warn); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
  #confirmApprove { background: var(--accent); color: white; border-color: var(--accent); }
  #confirmDeny { background: var(--error); color: white; border-color: var(--error); }
</style>
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <div class="sidebar-header">
      <h1>core-agent<span id="versionTag"></span></h1>
      <button id="sidebarToggle" title="Collapse sidebar">«</button>
    </div>
    <div id="sidebarBody">
      <dl id="status"><dd>Loading...</dd></dl>
      <div id="sessions"></div>
      <button id="newSessionBtn">+ New session</button>
      <details id="toolsPanel"><summary>Tools</summary><ul id="toolsList"></ul></details>
    </div>
  </aside>
  <main>
    <header id="header">
      <div id="headerBody">
        <span id="sessionName"></span>
        <span class="font-size-control">
          <button id="fontDecBtn" title="Decrease text size">A-</button>
          <span id="fontSizeLabel"></span>
          <button id="fontIncBtn" title="Increase text size">A+</button>
        </span>
        <label><input type="checkbox" id="toolLogToggle"> tools</label>
        <label><input type="checkbox" id="autoToggle"> auto</label>
        <button id="resetBtn">reset</button>
      </div>
      <button id="headerToggle" title="Collapse header">⌃</button>
    </header>
    <button id="headerFloatToggle" title="Expand header" hidden>⌄</button>
    <div id="log"></div>
    <footer>
      <div id="attachments" hidden></div>
      <div id="inputRow">
        <textarea id="input" rows="2" placeholder="Type your message... (Enter to send, Shift+Enter for newline, !cmd for shell, /help for commands)"></textarea>
        <button id="sendBtn">Send</button>
        <button id="abortBtn" hidden>Stop</button>
      </div>
    </footer>
  </main>
</div>
<div id="modalOverlay" hidden>
  <div class="modal-box">
    <h2 id="confirmTitle"></h2>
    <pre id="confirmPreview" hidden></pre>
    <div id="confirmPrompt">Approve? (y/N/a=always)</div>
    <div class="modal-actions">
      <button id="confirmApprove">y</button>
      <button id="confirmDeny">N</button>
      <button id="confirmAlways">a=always</button>
    </div>
  </div>
</div>
<div id="lightboxOverlay" hidden>
  <button id="lightboxClose" title="Close">×</button>
  <div id="lightboxContent"></div>
</div>
<script>
(function () {
  "use strict";

  var state = {
    sessionName: null,
    sending: false,
    currentAssistantEl: null,
    currentAssistantText: "",
    attachments: [], // {path, name, isImage, previewUrl}
  };

  var el = {
    sidebar: document.getElementById("sidebar"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    header: document.getElementById("header"),
    headerToggle: document.getElementById("headerToggle"),
    headerFloatToggle: document.getElementById("headerFloatToggle"),
    status: document.getElementById("status"),
    versionTag: document.getElementById("versionTag"),
    sessions: document.getElementById("sessions"),
    newSessionBtn: document.getElementById("newSessionBtn"),
    toolsList: document.getElementById("toolsList"),
    sessionName: document.getElementById("sessionName"),
    fontDecBtn: document.getElementById("fontDecBtn"),
    fontIncBtn: document.getElementById("fontIncBtn"),
    fontSizeLabel: document.getElementById("fontSizeLabel"),
    toolLogToggle: document.getElementById("toolLogToggle"),
    autoToggle: document.getElementById("autoToggle"),
    resetBtn: document.getElementById("resetBtn"),
    log: document.getElementById("log"),
    attachments: document.getElementById("attachments"),
    input: document.getElementById("input"),
    sendBtn: document.getElementById("sendBtn"),
    abortBtn: document.getElementById("abortBtn"),
    modalOverlay: document.getElementById("modalOverlay"),
    confirmTitle: document.getElementById("confirmTitle"),
    confirmPreview: document.getElementById("confirmPreview"),
    confirmApprove: document.getElementById("confirmApprove"),
    confirmDeny: document.getElementById("confirmDeny"),
    confirmAlways: document.getElementById("confirmAlways"),
    lightboxOverlay: document.getElementById("lightboxOverlay"),
    lightboxContent: document.getElementById("lightboxContent"),
    lightboxClose: document.getElementById("lightboxClose"),
  };

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // A small block-level Markdown-to-HTML renderer — not CommonMark-complete,
  // but covers what a chat response realistically uses: headings, lists,
  // blockquotes, hr, fenced/inline code, bold/italic/strikethrough, links,
  // and (unlike the TUI's terminal renderer, which deliberately leaves
  // tables as raw text — ANSI has no good way to draw one) GFM pipe tables,
  // since HTML can render those properly. Re-parses the whole
  // accumulated message on every delta rather than tracking parse state
  // incrementally — simpler, and cheap enough at chat-message sizes.
  function renderInline(text) {
    var s = escapeHtml(text);
    s = s.replace(/\`([^\`\n]+)\`/g, "<code>$1</code>");
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
    return s;
  }

  function isTableRow(line) {
    return line.indexOf("|") !== -1 && line.trim() !== "";
  }
  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.indexOf("-") !== -1;
  }
  function splitTableRow(line) {
    var trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map(function (c) { return c.trim(); });
  }
  function tableAligns(sepLine) {
    return splitTableRow(sepLine).map(function (c) {
      var left = c.charAt(0) === ":";
      var right = c.charAt(c.length - 1) === ":";
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return "";
    });
  }
  function renderTable(headerCells, aligns, bodyRows) {
    function cell(tag, c, idx) {
      var style = aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : "";
      return "<" + tag + style + ">" + renderInline(c) + "</" + tag + ">";
    }
    var thead = "<tr>" + headerCells.map(function (c, idx) { return cell("th", c, idx); }).join("") + "</tr>";
    var tbody = bodyRows
      .map(function (row) { return "<tr>" + row.map(function (c, idx) { return cell("td", c, idx); }).join("") + "</tr>"; })
      .join("");
    return "<table><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>";
  }

  function renderMarkdown(text) {
    var lines = text.split("\n");
    var html = "";
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      var fenceMatch = line.match(/^\`\`\`(\S*)\s*$/);
      if (fenceMatch) {
        var codeLines = [];
        i++;
        while (i < lines.length && !/^\`\`\`\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // consume closing fence, if it has arrived yet
        html += "<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>";
        continue;
      }

      if (/^\s*$/.test(line)) { i++; continue; }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html += "<hr>";
        i++;
        continue;
      }

      var headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        var level = headingMatch[1].length;
        html += "<h" + level + ">" + renderInline(headingMatch[2]) + "</h" + level + ">";
        i++;
        continue;
      }

      if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        var headerCells = splitTableRow(line);
        var aligns = tableAligns(lines[i + 1]);
        i += 2;
        var bodyRows = [];
        while (i < lines.length && isTableRow(lines[i]) && !/^\s*$/.test(lines[i])) {
          bodyRows.push(splitTableRow(lines[i]));
          i++;
        }
        html += renderTable(headerCells, aligns, bodyRows);
        continue;
      }

      if (/^>\s?/.test(line)) {
        var quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(renderInline(lines[i].replace(/^>\s?/, "")));
          i++;
        }
        html += "<blockquote>" + quoteLines.join("<br>") + "</blockquote>";
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        var ulItems = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          ulItems.push("<li>" + renderInline(lines[i].replace(/^\s*[-*+]\s+/, "")) + "</li>");
          i++;
        }
        html += "<ul>" + ulItems.join("") + "</ul>";
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        var olItems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          olItems.push("<li>" + renderInline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>");
          i++;
        }
        html += "<ol>" + olItems.join("") + "</ol>";
        continue;
      }

      var paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^\`\`\`/.test(lines[i]) &&
        !/^#{1,6}\s+/.test(lines[i]) &&
        !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        paraLines.push(renderInline(lines[i]));
        i++;
      }
      if (paraLines.length) {
        html += "<p>" + paraLines.join("<br>") + "</p>";
      } else {
        i++; // safety net against an unexpected zero-progress line
      }
    }
    return html;
  }

  function scrollLogToBottom() {
    el.log.scrollTop = el.log.scrollHeight;
  }

  function appendUserMessage(text) {
    var div = document.createElement("div");
    div.className = "msg user";
    div.textContent = text;
    el.log.appendChild(div);
    scrollLogToBottom();
  }

  function startAssistantMessage() {
    var div = document.createElement("div");
    div.className = "msg assistant";
    el.log.appendChild(div);
    state.currentAssistantEl = div;
    state.currentAssistantText = "";
    scrollLogToBottom();
  }

  function appendAssistantDelta(text) {
    if (!state.currentAssistantEl) startAssistantMessage();
    state.currentAssistantText += text;
    state.currentAssistantEl.innerHTML = renderMarkdown(state.currentAssistantText);
    scrollLogToBottom();
  }

  function finishAssistantMessage() {
    state.currentAssistantEl = null;
    state.currentAssistantText = "";
  }

  function appendSysLine(text, cls) {
    var div = document.createElement("div");
    div.className = "sys-line" + (cls ? " " + cls : "");
    div.textContent = text;
    el.log.appendChild(div);
    scrollLogToBottom();
  }

  // Reuses the .msg styling (headings/tables/etc.) so a Markdown-formatted
  // block — e.g. /help's command/tool tables — renders the same as an
  // assistant reply, rather than as a plain sys-line.
  function appendMarkdownBlock(markdown) {
    var div = document.createElement("div");
    div.className = "msg assistant";
    div.innerHTML = renderMarkdown(markdown);
    el.log.appendChild(div);
    scrollLogToBottom();
  }

  // Table cells are naively split on "|" (see splitTableRow) — a
  // description containing a literal pipe (possible for a skill-provided
  // tool) would otherwise corrupt the table structure, so swap it for a
  // visually similar full-width character instead of trying to teach the
  // parser backslash-escaping just for this one caller.
  function tableCell(s) {
    return String(s).replace(/\|/g, "｜").replace(/\n/g, " ");
  }

  function showThinking() {
    var div = document.createElement("div");
    div.id = "thinkingIndicator";
    div.className = "sys-line";
    div.innerHTML = '<span class="spinner"></span>thinking...';
    el.log.appendChild(div);
    scrollLogToBottom();
  }

  function hideThinking() {
    var indicator = document.getElementById("thinkingIndicator");
    if (indicator) indicator.remove();
  }

  function appendToolCall(name, args) {
    appendSysLine("[tool call] " + name + "(" + args + ")", "tool-line");
  }

  var MEDIA_EXT = {
    png: "img", jpg: "img", jpeg: "img", gif: "img", webp: "img", svg: "img",
    mp4: "video", webm: "video", mov: "video",
    mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio",
  };

  // Renders show_media's target inline (image/video sized to fit the
  // session column, audio as the native control bar) instead of only
  // relying on the tool's own open()-on-the-server-machine behavior, which
  // is invisible when the browser is on a different LAN machine than the
  // server. A download link rides along since the file only physically
  // exists on the server — the viewer has no other way to get a copy onto
  // their own machine.
  //
  // Anything that isn't a natively browser-renderable image/video/audio
  // (PDF, docx, a zip, ...) falls back to a plain file icon + name — same
  // idea as the pre-send attachment chips, and deliberately not a real
  // document viewer: that's a lot of surface area (PDF.js, format-specific
  // renderers) for something a download link already covers reasonably —
  // "generate a PDF and hand it to the user" doesn't need it rendered
  // in-session, just gettable.
  function appendMediaPreview(mediaPath) {
    var ext = (mediaPath.split(".").pop() || "").toLowerCase();
    var kind = MEDIA_EXT[ext] || "file";

    var url = "/api/media?path=" + encodeURIComponent(mediaPath);
    var filename = mediaPath.split(/[\\/]/).pop() || "download";

    var container = document.createElement("div");
    container.className = "media-preview" + (kind === "file" ? " file-kind" : "");

    if (kind === "file") {
      var icon = document.createElement("span");
      icon.className = "media-file-icon";
      icon.textContent = "📄";
      container.appendChild(icon);

      var label = document.createElement("span");
      label.className = "media-file-name";
      label.textContent = filename;
      container.appendChild(label);
    } else {
      var mediaEl = document.createElement(kind === "img" ? "img" : kind);
      mediaEl.src = url;
      if (kind === "img") mediaEl.alt = filename;
      else mediaEl.controls = true;

      var mediaWrap = document.createElement("div");
      mediaWrap.className = "media-wrap";
      mediaWrap.appendChild(mediaEl);

      if (kind === "img") {
        // Images have no interactive controls of their own, so the whole
        // element can just be the click target.
        mediaEl.addEventListener("click", function () { openLightbox(kind, url); });
      } else if (kind === "video") {
        // A click listener on the <video> itself would also fire for
        // clicks on its native play/pause/scrub controls — a separate
        // overlay button keeps "maximize" and "use the player" from
        // fighting over the same click.
        var expandBtn = document.createElement("button");
        expandBtn.className = "media-expand";
        expandBtn.title = "Fullscreen";
        expandBtn.textContent = "⛶";
        expandBtn.addEventListener("click", function () { openLightbox(kind, url); });
        mediaWrap.appendChild(expandBtn);
      }
      container.appendChild(mediaWrap);
    }

    var dl = document.createElement("a");
    dl.className = "media-download";
    dl.href = url;
    dl.download = filename;
    dl.title = "Download " + filename;
    dl.textContent = "⬇";
    container.appendChild(dl);

    el.log.appendChild(container);
    scrollLogToBottom();
  }

  function appendToolResult(name, content) {
    var preview = content.length > 300 ? content.slice(0, 300) + "..." : content;
    appendSysLine("[tool result: " + name + "]\n" + preview, "tool-line");
  }

  async function api(path, opts) {
    var res = await fetch(path, opts);
    if (!res.ok) throw new Error("HTTP " + res.status + " on " + path);
    return res;
  }

  function statusRow(label, value) {
    return "<dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(value) + "</dd>";
  }

  async function loadStatus() {
    var res = await api("/api/status");
    var s = await res.json();
    if (s.version && el.versionTag) el.versionTag.textContent = "v" + s.version;
    var rows = [statusRow("model", s.model), statusRow("endpoint", s.baseUrl)];
    if (s.version) rows.push(statusRow("version", s.version));
    if (s.projectInstructions) rows.push(statusRow("instructions", "loaded"));
    if (s.skills.length) rows.push(statusRow("skills", s.skills.join(", ")));
    if (s.hookCount) rows.push(statusRow("hooks", String(s.hookCount)));
    if (s.cronJobs && s.cronJobs.length) {
      var cronText = s.cronJobs.map(function (j) { return j.name + " (" + j.schedule + ")"; }).join(", ");
      rows.push(statusRow("cron", cronText));
    } else if (s.cronScheduled) {
      rows.push(statusRow("cron", String(s.cronScheduled)));
    }
    el.status.innerHTML = rows.join("");
    el.toolsList.innerHTML = "";
    s.tools.forEach(function (t) {
      var li = document.createElement("li");
      li.textContent = t.name + " — " + t.description;
      el.toolsList.appendChild(li);
    });
  }

  function formatRelativeTime(iso) {
    var diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return Math.round(diffSec / 60) + "m ago";
    if (diffSec < 86400) return Math.round(diffSec / 3600) + "h ago";
    return Math.round(diffSec / 86400) + "d ago";
  }

  async function loadSessionList() {
    var res = await api("/api/sessions");
    var sessions = await res.json();
    el.sessions.innerHTML = "";
    sessions.forEach(function (s) {
      var div = document.createElement("div");
      div.className = "session-item" + (s.name === state.sessionName ? " active" : "");
      div.addEventListener("click", function () { switchSession(s.name); });

      var left = document.createElement("div");
      left.className = "left";
      var nameEl = document.createElement("span");
      nameEl.className = "name";
      nameEl.textContent = s.name;
      var metaEl = document.createElement("span");
      metaEl.className = "meta";
      metaEl.textContent = s.messageCount + " · " + formatRelativeTime(s.updatedAt);
      left.appendChild(nameEl);
      left.appendChild(metaEl);
      div.appendChild(left);

      var delBtn = document.createElement("button");
      delBtn.className = "session-delete";
      delBtn.title = "Delete session";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        deleteSessionByName(s.name);
      });
      div.appendChild(delBtn);

      el.sessions.appendChild(div);
    });
  }

  // Deleting the session currently open needs somewhere to land afterward —
  // falls back to whatever's left in the list, or "default" (server-side
  // recreates "default" immediately on delete, so this always resolves to
  // a real session rather than an empty sidebar).
  async function deleteSessionByName(name) {
    if (!confirm('Delete session "' + name + '"? This cannot be undone.')) return;
    await api("/api/session/" + encodeURIComponent(name), { method: "DELETE" });
    if (name === state.sessionName) {
      var res = await api("/api/sessions");
      var remaining = await res.json();
      var next = remaining.length ? remaining[0].name : "default";
      await switchSession(next);
    } else {
      await loadSessionList();
    }
  }

  async function switchSession(name) {
    if (state.sending) return;
    state.sessionName = name;
    el.sessionName.textContent = name;
    el.log.innerHTML = "";
    finishAssistantMessage();
    var res = await api("/api/session/" + encodeURIComponent(name));
    var data = await res.json();
    el.autoToggle.checked = !!data.autoMode;
    data.messages.forEach(function (m) {
      if (m.role === "user") {
        appendUserMessage(m.content);
      } else if (m.role === "assistant") {
        if (m.content) {
          startAssistantMessage();
          appendAssistantDelta(m.content);
          finishAssistantMessage();
        }
        if (m.toolCalls) {
          m.toolCalls.forEach(function (c) {
            appendToolCall(c.name, c.arguments);
            if (c.name === "show_media" && c.mediaPath) appendMediaPreview(c.mediaPath);
          });
        }
      } else if (m.role === "tool") {
        appendToolResult(m.name, m.content);
      }
    });
    await loadSessionList();
  }

  var SIDEBAR_COLLAPSED_KEY = "core-agent-sidebar-collapsed";
  function setSidebarCollapsed(collapsed) {
    el.sidebar.classList.toggle("collapsed", collapsed);
    el.sidebarToggle.textContent = collapsed ? "»" : "«";
    el.sidebarToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  el.sidebarToggle.addEventListener("click", function () {
    setSidebarCollapsed(!el.sidebar.classList.contains("collapsed"));
  });
  try {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setSidebarCollapsed(true);
  } catch (e) { /* ignore */ }

  // Collapsed = the header is removed from the flow entirely (hidden, not
  // just shrunk) so it actually gives the line back, as opposed to the
  // earlier version which just padded it down to 2px and still reserved a
  // full-width row. A small floating button (positioned absolutely over
  // #log, doesn't participate in layout) is the only way back in.
  var HEADER_COLLAPSED_KEY = "core-agent-header-collapsed";
  function setHeaderCollapsed(collapsed) {
    el.header.hidden = collapsed;
    el.headerFloatToggle.hidden = !collapsed;
    try { localStorage.setItem(HEADER_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  el.headerToggle.addEventListener("click", function () { setHeaderCollapsed(true); });
  el.headerFloatToggle.addEventListener("click", function () { setHeaderCollapsed(false); });
  try {
    if (localStorage.getItem(HEADER_COLLAPSED_KEY) === "1") setHeaderCollapsed(true);
  } catch (e) { /* ignore */ }

  // Text size of the chat column (right side) only — the sidebar/header
  // chrome stays fixed. Applied to #log so it cascades into .msg/.sys-line
  // (their headings/etc. use em-relative sizing already, so this scales the
  // whole message body proportionally rather than just the base text). Also
  // applied to #input — it's the same "right side" column as the log, just
  // below it, so it should scale along with everything else there.
  var FONT_SIZE_KEY = "core-agent-font-size";
  var FONT_SIZE_MIN = 11;
  var FONT_SIZE_MAX = 22;
  var FONT_SIZE_DEFAULT = 14;
  var fontSize = FONT_SIZE_DEFAULT;
  function applyFontSize(size) {
    fontSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, size));
    el.log.style.fontSize = fontSize + "px";
    el.input.style.fontSize = fontSize + "px";
    el.fontSizeLabel.textContent = fontSize + "px";
    try { localStorage.setItem(FONT_SIZE_KEY, String(fontSize)); } catch (e) { /* ignore */ }
  }
  el.fontDecBtn.addEventListener("click", function () { applyFontSize(fontSize - 1); });
  el.fontIncBtn.addEventListener("click", function () { applyFontSize(fontSize + 1); });
  (function () {
    var saved = FONT_SIZE_DEFAULT;
    try {
      var stored = parseInt(localStorage.getItem(FONT_SIZE_KEY), 10);
      if (!isNaN(stored)) saved = stored;
    } catch (e) { /* ignore */ }
    applyFontSize(saved);
  })();

  // Whole-session show/hide for [tool call]/[tool result] lines — they can
  // get long and numerous enough to bury the actual conversation. A CSS
  // class toggle on #log rather than not rendering them at all, so nothing
  // is lost by flipping it back on mid-session.
  var TOOL_LOG_HIDDEN_KEY = "core-agent-tool-log-hidden";
  function setToolLogHidden(hidden) {
    el.log.classList.toggle("hide-tool-lines", hidden);
    el.toolLogToggle.checked = !hidden;
    try { localStorage.setItem(TOOL_LOG_HIDDEN_KEY, hidden ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  el.toolLogToggle.addEventListener("change", function () {
    setToolLogHidden(!el.toolLogToggle.checked);
  });
  try {
    // Default hidden — only an explicit prior "0" (user turned it on) keeps
    // tool lines visible; no stored value at all still means hidden.
    setToolLogHidden(localStorage.getItem(TOOL_LOG_HIDDEN_KEY) !== "0");
  } catch (e) {
    setToolLogHidden(true);
  }

  el.newSessionBtn.addEventListener("click", function () {
    var name = prompt("New session name:");
    if (name && name.trim()) switchSession(name.trim());
  });

  el.resetBtn.addEventListener("click", async function () {
    if (!state.sessionName || state.sending) return;
    await api("/api/session/" + encodeURIComponent(state.sessionName) + "/reset", { method: "POST" });
    el.log.innerHTML = "";
    finishAssistantMessage();
    appendSysLine("Session reset.");
    await loadSessionList();
  });

  el.autoToggle.addEventListener("change", async function () {
    if (!state.sessionName) return;
    await api("/api/session/" + encodeURIComponent(state.sessionName) + "/auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: el.autoToggle.checked }),
    });
  });

  var pendingConfirm = null;
  var CONFIRM_TITLE_MAX = 160;
  function showConfirm(req) {
    pendingConfirm = req.id;
    var full = req.tool + ": " + req.description;
    var titleTruncated = full.length > CONFIRM_TITLE_MAX;
    el.confirmTitle.textContent = titleTruncated ? full.slice(0, CONFIRM_TITLE_MAX) + "..." : full;

    // Some tools (e.g. bash) put the only copy of the interesting text —
    // the full command — into \`description\` rather than a separate
    // \`preview\`; if the title got truncated and there's no preview to fall
    // back on, show the untruncated description in the scrollable preview
    // box instead so nothing is actually lost, just moved.
    var previewText = req.preview || (titleTruncated ? req.description : "");
    if (previewText) {
      el.confirmPreview.hidden = false;
      el.confirmPreview.textContent = previewText.length > 2000 ? previewText.slice(0, 2000) + "..." : previewText;
    } else {
      el.confirmPreview.hidden = true;
    }
    el.modalOverlay.hidden = false;
  }

  function hideConfirm() {
    el.modalOverlay.hidden = true;
    pendingConfirm = null;
  }

  async function answerConfirm(approved, always) {
    if (!pendingConfirm) return;
    var id = pendingConfirm;
    hideConfirm();
    await api("/api/confirm/" + id, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: approved, always: !!always }),
    });
    if (always) el.autoToggle.checked = true;
  }

  el.confirmApprove.addEventListener("click", function () { answerConfirm(true, false); });
  el.confirmDeny.addEventListener("click", function () { answerConfirm(false, false); });

  // Single-keystroke y/N/a, mirroring the TUI's "Approve? (y/N/a=always)"
  // prompt — the modal only ever appears while the input is disabled
  // (setSending(true) during a turn), so there's no live text field these
  // keys could otherwise leak into.
  document.addEventListener("keydown", function (e) {
    if (el.modalOverlay.hidden) return;
    var key = e.key.toLowerCase();
    if (key === "y") { e.preventDefault(); answerConfirm(true, false); }
    else if (key === "n" || key === "escape") { e.preventDefault(); answerConfirm(false, false); }
    else if (key === "a") { e.preventDefault(); answerConfirm(true, true); }
  });
  el.confirmAlways.addEventListener("click", function () { answerConfirm(true, true); });

  function setSending(sending) {
    state.sending = sending;
    el.sendBtn.disabled = sending;
    el.abortBtn.hidden = !sending;
    el.input.disabled = sending;
  }

  async function abortTurn() {
    if (!state.sessionName) return;
    await api("/api/session/" + encodeURIComponent(state.sessionName) + "/abort", { method: "POST" });
  }
  el.abortBtn.addEventListener("click", abortTurn);

  function openLightbox(kind, url) {
    el.lightboxContent.innerHTML = "";
    var big = document.createElement(kind);
    big.src = url;
    if (kind === "video") {
      big.controls = true;
      big.autoplay = true;
    }
    el.lightboxContent.appendChild(big);
    el.lightboxOverlay.hidden = false;
  }
  function closeLightbox() {
    el.lightboxOverlay.hidden = true;
    el.lightboxContent.innerHTML = ""; // removing it stops any playing video/audio
  }
  el.lightboxClose.addEventListener("click", closeLightbox);
  el.lightboxOverlay.addEventListener("click", function (e) {
    if (e.target === el.lightboxOverlay || e.target === el.lightboxContent) closeLightbox();
  });

  // Esc-to-interrupt, mirroring the TUI's mid-stream Esc handling. Guarded
  // on the confirm modal being closed — while it's open, Esc is already
  // spoken for as "Deny" by the keydown listener above, and firing both
  // would abort the turn AND deny the confirmation on the same keypress.
  // The lightbox takes priority over both: Esc closing whatever's visually
  // on top is the least surprising behavior when several things could
  // technically be listening for the same keypress.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!el.lightboxOverlay.hidden) {
      e.preventDefault();
      closeLightbox();
      return;
    }
    if (!el.modalOverlay.hidden || !state.sending) return;
    e.preventDefault();
    abortTurn();
  });

  // Mirrors cli.ts's REPL_COMMANDS + printHelp() — a local, hardcoded
  // reference that never touches the model (same reasoning as the TUI: a
  // real LLM call to explain "what commands exist" would be wasteful and
  // the answer never changes at runtime).
  var GUI_COMMANDS = {
    "/help, /?": "Show this help",
    "!<command>": "Run a shell command directly, bypassing the model (e.g. !ls, !cd ..)",
    "y / N / a": "At a confirm prompt: approve / deny / approve+always (or click the buttons)",
    "Esc": "Interrupt the response mid-stream (partial text is kept; running tools are not stopped)",
    "+ New session / sidebar list": "Create or switch sessions",
    "Reset button": "Clear the current session's conversation history",
    "auto toggle": "Approve write/edit/bash/skill tools without asking",
    "Drag & drop": "Drop a file to upload it and insert its path into the message",
  };

  async function showHelp() {
    var md = ["### GUI commands", "", "| Command | Description |", "|---|---|"];
    Object.keys(GUI_COMMANDS).forEach(function (k) {
      md.push("| " + tableCell(k) + " | " + tableCell(GUI_COMMANDS[k]) + " |");
    });
    try {
      var status = await (await api("/api/status")).json();
      md.push("", "### Tools available to the agent", "", "| Tool | Description |", "|---|---|");
      status.tools.forEach(function (t) {
        md.push("| " + tableCell(t.name) + " | " + tableCell(t.description) + " |");
      });
    } catch (err) {
      // still show the commands above even if /api/status is unreachable
    }
    appendMarkdownBlock(md.join("\n"));
  }

  async function runShellCommand(command) {
    appendSysLine("$ " + command);
    try {
      var res = await api("/api/session/" + encodeURIComponent(state.sessionName) + "/shell", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: command }),
      });
      var data = await res.json();
      var output = (data.output || "").replace(/\n$/, "");
      if (output) appendSysLine(output);
      if (data.exitCode) appendSysLine("[exit " + data.exitCode + "]", "warn");
    } catch (err) {
      appendSysLine("[shell error: " + (err && err.message ? err.message : err) + "]", "error");
    }
  }

  async function sendMessage() {
    var text = el.input.value;
    if ((!text.trim() && !state.attachments.length) || state.sending || !state.sessionName) return;
    el.input.value = "";

    var trimmed = text.trim();
    if (trimmed === "/help" || trimmed === "/?") {
      await showHelp();
      return;
    }
    if (trimmed.charAt(0) === "!") {
      var command = trimmed.slice(1).trim();
      if (command) await runShellCommand(command);
      return;
    }

    // Attachment chips carry no text of their own — their paths get folded
    // into the outgoing message here so the model still receives them. A
    // bare path sitting in the message isn't a strong enough signal for the
    // model to reliably reach for view_image on its own (observed in
    // practice: it would sometimes just answer without calling any tool),
    // so each one is spelled out explicitly instead of just concatenated.
    var attachmentLines = state.attachments.map(function (a) {
      return a.isImage
        ? "[Attached image — call view_image on this path if you need to see it: " + a.path + "]"
        : "[Attached file: " + a.path + "]";
    });
    state.attachments.forEach(function (a) { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
    state.attachments = [];
    renderAttachments();
    var fullText = attachmentLines.length ? (text.trim() ? text + "\n" : "") + attachmentLines.join("\n") : text;

    appendUserMessage(fullText);
    setSending(true);
    showThinking();

    try {
      var res = await fetch("/api/session/" + encodeURIComponent(state.sessionName) + "/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: fullText }),
      });
      if (!res.ok || !res.body) throw new Error("HTTP " + res.status);

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i]) continue;
          handleEvent(JSON.parse(lines[i]));
        }
      }
      if (buf.trim()) handleEvent(JSON.parse(buf));
    } catch (err) {
      appendSysLine("[GUI error: " + (err && err.message ? err.message : err) + "]", "error");
    } finally {
      hideThinking();
      finishAssistantMessage();
      setSending(false);
      await loadSessionList();
    }
  }

  function handleEvent(evt) {
    if (evt.type !== "done") hideThinking();
    switch (evt.type) {
      case "text_delta":
        appendAssistantDelta(evt.text);
        break;
      case "tool_call":
        finishAssistantMessage();
        appendToolCall(evt.name, evt.args);
        if (evt.name === "show_media" && evt.mediaPath) appendMediaPreview(evt.mediaPath);
        // The gap between a tool_call arriving and its tool_result landing
        // is the tool actually running (bash, search, a slow visit_page...)
        // — leaving the spinner off here was the actual flicker: it showed
        // pre-first-token, vanished the instant tool_call hid it, then only
        // came back once the tool finished. Re-showing it right away keeps
        // it lit continuously through that gap instead.
        showThinking();
        break;
      case "tool_result":
        appendToolResult(evt.name, evt.content);
        // Same gap, the other side: tool result landed, but the model's
        // next round (more tool calls, or the final answer) hasn't started
        // streaming yet.
        showThinking();
        break;
      case "compact":
        appendSysLine("[history compacted to stay within context budget]");
        break;
      case "error":
        appendSysLine("[LLM request failed: " + evt.message + "]", "error");
        break;
      case "confirm_request":
        finishAssistantMessage();
        showConfirm(evt);
        break;
      case "aborted":
        appendSysLine("[Interrupted]", "warn");
        break;
      case "done":
        break;
    }
  }

  // IME composition (e.g. Japanese kana->kanji conversion) confirms with
  // Enter too — without this guard, confirming a conversion mid-sentence
  // fires the same keydown and sends the message early. e.isComposing alone
  // isn't reliable across browsers, so track compositionstart/end directly
  // and also check keyCode 229 (the standard "IME is processing this key"
  // signal) as a second guard for engines that report isComposing late.
  var composing = false;
  el.input.addEventListener("compositionstart", function () { composing = true; });
  el.input.addEventListener("compositionend", function () { composing = false; });

  el.sendBtn.addEventListener("click", sendMessage);
  el.input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !composing && e.keyCode !== 229 && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  // A TUI drops a file's path in as plain text because that's all a
  // terminal input can hold; a GUI doesn't have that constraint, so a
  // dropped file shows as a chip (thumbnail for images, an icon for
  // everything else) instead of a raw path string cluttering the textarea.
  // The actual path still gets appended to the message text at send time —
  // the model needs it to call view_image/show_media — it's just not shown
  // to the human that way anymore.
  function renderAttachments() {
    el.attachments.innerHTML = "";
    el.attachments.hidden = state.attachments.length === 0;
    state.attachments.forEach(function (a, idx) {
      var chip = document.createElement("div");
      chip.className = "attachment-chip";
      if (a.isImage && a.previewUrl) {
        var img = document.createElement("img");
        img.src = a.previewUrl;
        img.alt = a.name;
        chip.appendChild(img);
      } else {
        var icon = document.createElement("span");
        icon.className = "attachment-icon";
        icon.textContent = "📄";
        chip.appendChild(icon);
      }
      var label = document.createElement("span");
      label.className = "attachment-name";
      label.textContent = a.name;
      label.title = a.path;
      chip.appendChild(label);
      var remove = document.createElement("button");
      remove.className = "attachment-remove";
      remove.textContent = "×";
      remove.title = "Remove";
      remove.addEventListener("click", function () {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
        state.attachments.splice(idx, 1);
        renderAttachments();
      });
      chip.appendChild(remove);
      el.attachments.appendChild(chip);
    });
  }

  // Browsers deliberately don't expose a dropped file's real filesystem
  // path (unlike a terminal, which just inserts the path as text) — so
  // instead the bytes get uploaded to the server, saved under the OS temp
  // dir, and the resulting absolute path becomes an attachment chip. From
  // there it's an ordinary path the model can call view_image/show_media
  // on, same as it would with a TUI-dropped path.
  async function uploadFile(file) {
    var isImage = file.type && file.type.indexOf("image/") === 0;
    var previewUrl = isImage ? URL.createObjectURL(file) : null;
    try {
      var buf = await file.arrayBuffer();
      var res = await fetch("/api/upload?filename=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: buf,
      });
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error(errBody.error || "HTTP " + res.status);
      }
      var data = await res.json();
      state.attachments.push({ path: data.path, name: file.name, isImage: isImage, previewUrl: previewUrl });
      renderAttachments();
    } catch (err) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      appendSysLine("[upload failed: " + (err && err.message ? err.message : err) + "]", "error");
    }
  }

  document.addEventListener("dragover", function (e) {
    e.preventDefault();
  });
  document.addEventListener("drop", function (e) {
    e.preventDefault();
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    for (var i = 0; i < e.dataTransfer.files.length; i++) uploadFile(e.dataTransfer.files[i]);
  });

  async function init() {
    await loadStatus();
    var res = await api("/api/sessions");
    var sessions = await res.json();
    var initial = sessions.length ? sessions[0].name : "default";
    await switchSession(initial);

    // Cron jobs are typically edited while the server is left running (no
    // reason to restart just to update a schedule/prompt) — polling here
    // means a cron.json change shows up in the sidebar without the user
    // needing to know to reload. Errors are swallowed: a transient network
    // hiccup on one poll shouldn't produce a visible error, it'll just
    // catch up on the next tick.
    setInterval(function () {
      loadStatus().catch(function () {});
    }, 30000);
  }

  init().catch(function (err) {
    el.status.textContent = "Failed to load: " + (err && err.message ? err.message : err);
  });
})();
</script>
</body>
</html>
`;
