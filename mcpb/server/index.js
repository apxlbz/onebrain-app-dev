#!/usr/bin/env node
/* OneBrain for Claude Desktop — the server inside the extension bundle.
 *
 * Claude Desktop speaks MCP to local processes over stdio. OneBrain's MCP
 * endpoint is remote (streamable HTTP, bearer-authenticated). This file is
 * the bridge: each JSON-RPC line from stdin is POSTed to OneBrain with the
 * personal token, and whatever comes back — JSON or an SSE frame — is
 * written to stdout as JSON-RPC lines. No dependencies: Node 18+ has fetch.
 */
'use strict';

const URL_ = process.env.ONEBRAIN_MCP_URL || '';
const TOKEN = process.env.ONEBRAIN_TOKEN || '';
let sessionId = '';

const reply = (obj) => { process.stdout.write(JSON.stringify(obj) + '\n'); };
const fail = (id, message) => reply({ jsonrpc: '2.0', id, error: { code: -32000, message } });

function emit(text) {
  let m;
  try { m = JSON.parse(text); } catch { return; }
  for (const x of Array.isArray(m) ? m : [m]) reply(x);
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* One POST, with patience: the endpoint is a serverless function, and the
 * first request after a quiet spell can meet a cold start that answers 5xx
 * or drops. Claude Desktop sends "initialize" the moment it launches, so
 * that first request is exactly the one most likely to hit it. */
async function post(line) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(600 * 2 ** (attempt - 1));
    try {
      const r = await fetch(URL_, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${TOKEN}`,
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        },
        body: line,
      });
      if (r.status >= 500 && attempt < 3) { last = new Error(`HTTP ${r.status}`); continue; }
      return r;
    } catch (e) { last = e; }
  }
  throw last;
}

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const hasId = msg.id !== undefined && msg.id !== null;
  if (!URL_ || !TOKEN) {
    if (hasId) fail(msg.id, 'OneBrain extension is missing its address or token — reinstall it from the OneBrain setup page.');
    return;
  }
  try {
    const r = await post(line);
    const sid = r.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    if (r.status === 202 || r.status === 204) return;          // a notification, acknowledged
    const text = await r.text();
    if (!r.ok) {
      if (hasId) fail(msg.id, `OneBrain answered HTTP ${r.status}: ${text.slice(0, 200)}`);
      return;
    }
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) {
      for (const frame of text.split(/\r?\n\r?\n/)) {
        const data = frame.split(/\r?\n/).filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim()).join('\n');
        if (data) emit(data);
      }
    } else if (text.trim()) {
      emit(text);
    }
  } catch (e) {
    if (hasId) fail(msg.id, `OneBrain is unreachable: ${e.message}`);
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});
process.stdin.on('end', () => process.exit(0));
