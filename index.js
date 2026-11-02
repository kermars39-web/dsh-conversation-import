/**
 * Host half of the Codex conversation importer.
 *
 * Reads a Codex rollout (`codex://threads/<id>`), rebuilds it as a native
 * Harness session log under the original working directory, and exposes a
 * tiny same-origin JSON endpoint for the sidebar panel.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROUTE_PREFIX = '/codex-importer';
const PROVIDER = 'deepseek-account';
const MODEL = 'deepseek-flash';
const MAX_COMMAND_CHARS = 20000;
const MAX_OUTPUT_CHARS = 120000;
const MAX_FILE_CHARS = 120000;
const APPEND_CHUNK = 80;
const SESSION_FORMAT_VERSION = 4;
const AUTO_SYNC_MS = 60000;

export const inject = ['sessionPersistence', 'workspaceRegistry'];

export function apply(ctx) {
  const env = {
    codexHome: path.join(os.homedir(), '.codex'),
    stateFile: path.join(os.homedir(), '.dsh', 'codex-importer', 'imports.json'),
  };
  const handler = (req, res) => {
    handleRequest(ctx, env, req, res).catch((error) => {
      try {
        sendJson(res, error?.status || 500, {
          ok: false,
          error: { message: error?.expose === false ? '导入失败' : String(error?.message || error) },
        });
      } catch {
        /* response already gone */
      }
    });
  };
  installRoute(ctx, handler);
  ctx.effect(() => {
    const handle = setInterval(() => {
      autoSyncTick(ctx, env).catch(() => {});
    }, AUTO_SYNC_MS);
    if (typeof handle.unref === 'function') handle.unref();
    return () => clearInterval(handle);
  });
}

let syncRunning = false;

async function autoSyncTick(ctx, env) {
  if (syncRunning) return;
  const state = await readState(env);
  if (state.autoSync === false) return;
  const pending = Object.entries(state.imports).filter(([, record]) => record && record.sync !== false && record.sessionId);
  if (!pending.length) return;
  syncRunning = true;
  try {
    await runSync(ctx, env, state, pending, false);
  } finally {
    syncRunning = false;
  }
}

function installRoute(ctx, handler) {
  const install = (scope) => {
    const webServer = scope?.webServer || scope?.get?.('webServer');
    if (!webServer) return;
    scope.effect(() =>
      webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
    );
  };
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], install);
      return;
    } catch {
      /* fall through to the direct lookup */
    }
  }
  const webServer = ctx.get('webServer');
  if (webServer) ctx.effect(() => webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }));
}

/* ------------------------------------------------------------------ HTTP --- */

async function handleRequest(ctx, env, req, res) {
  const url = new URL(req.url || ROUTE_PREFIX, 'http://localhost');
  const route = url.pathname.startsWith(ROUTE_PREFIX)
    ? url.pathname.slice(ROUTE_PREFIX.length) || '/'
    : url.pathname;
  res.setHeader('cache-control', 'no-store');
  // This route can read local conversations and write Sessions, so it must sit
  // behind Connection's Host/Origin and browser-credential admission instead of
  // trusting any local HTTP caller. A missing admission service fails closed.
  const rejected = connectionRejection(ctx, req);
  if (rejected) {
    sendJson(res, rejected.status, { ok: false, error: { message: rejected.message } });
    return;
  }
  if (req.method === 'GET' && route === '/ping') {
    sendJson(res, 200, { ok: true, codexHome: env.codexHome, stateFile: env.stateFile });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: { message: '仅支持 POST' } });
    return;
  }
  const body = await readJsonBody(req);
  if (route === '/preview') return preview(ctx, env, body, res);
  if (route === '/import') return importFromRequest(ctx, env, body, res);
  if (route === '/recent') return recentThreads(env, res);
  if (route === '/sync') return syncRequest(ctx, env, body, res);
  if (route === '/settings') return settingsRequest(env, body, res);
  if (route === '/verify') return verify(ctx, body, res);
  if (route === '/imports') return listImports(env, res);
  sendJson(res, 404, { ok: false, error: { message: `未知接口 ${route}` } });
}

function connectionRejection(ctx, req) {
  let connection = null;
  try {
    connection = ctx.get('connection');
  } catch {
    connection = null;
  }
  if (!connection || typeof connection.requestRejection !== 'function') {
    return { status: 503, message: '拒绝访问：连接准入服务不可用' };
  }
  let rejection;
  try {
    rejection = connection.requestRejection({ headers: req.headers || {} });
  } catch {
    return { status: 503, message: '拒绝访问：连接准入检查失败' };
  }
  if (rejection === 401) return { status: 401, message: '拒绝访问：未经认证的请求' };
  if (rejection === 403) return { status: 403, message: '拒绝访问：来源校验未通过' };
  return null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(bad('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(bad('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  const payload = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
}

/* ------------------------------------------------------------------ state --- */

async function readState(env) {
  let state = null;
  try {
    const parsed = JSON.parse(await fsp.readFile(env.stateFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.imports && typeof parsed.imports === 'object') state = parsed;
  } catch {
    /* first run */
  }
  if (!state) return { version: 2, autoSync: true, imports: {} };
  state.version = 2;
  if (typeof state.autoSync !== 'boolean') state.autoSync = true;
  return state;
}

async function writeState(env, state) {
  await fsp.mkdir(path.dirname(env.stateFile), { recursive: true });
  const tmp = `${env.stateFile}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, env.stateFile);
}

async function recentThreads(env, res) {
  const state = await readState(env);
  const files = await indexRolloutFiles(env.codexHome);
  const index = await readSessionIndex(env.codexHome);
  // Automation threads reuse one title hundreds of times; they are noise in a
  // picker meant for conversations a person would open.
  const titleCounts = new Map();
  for (const entry of index) {
    const title = typeof entry.thread_name === 'string' ? entry.thread_name.trim() : '';
    if (!title) continue;
    titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
  }
  const threads = [];
  const seen = new Set();
  for (const entry of index) {
    if (!entry.id || seen.has(entry.id)) continue;
    const file = files.get(entry.id);
    if (!file) continue;
    const title = typeof entry.thread_name === 'string' ? entry.thread_name.trim() : '';
    if (title && (titleCounts.get(title) || 0) >= 25) continue;
    if (!title && !entry.updated_at) continue;
    seen.add(entry.id);
    threads.push({
      threadId: entry.id,
      title: entry.thread_name || `对话 ${entry.id.slice(0, 8)}`,
      updatedAt: entry.updatedAt ? Date.parse(entry.updated_at) : file.mtime,
      deepLink: `codex://threads/${entry.id}`,
      cwd: await readRolloutCwd(file),
      alreadyImported: state.imports[entry.id]?.sessionId ?? null,
    });
    if (threads.length >= 12) break;
  }
  sendJson(res, 200, { ok: true, threads });
}

async function readSessionIndex(codexHome) {
  try {
    const text = await fsp.readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8');
    const rows = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record && typeof record.id === 'string') rows.push(record);
      } catch {
        /* skip broken line */
      }
    }
    return rows.reverse();
  } catch {
    return [];
  }
}

async function indexRolloutFiles(codexHome) {
  const files = new Map();
  const walk = async (dir, depth) => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) await walk(full, depth - 1);
        continue;
      }
      const match = entry.name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (!match) continue;
      let mtime = 0;
      try {
        mtime = (await fsp.stat(full)).mtimeMs;
      } catch {
        /* ignore */
      }
      const id = match[1].toLowerCase();
      const previous = files.get(id);
      if (!previous || mtime > previous.mtime) files.set(id, { file: full, mtime });
    }
  };
  await walk(path.join(codexHome, 'sessions'), 4);
  await walk(path.join(codexHome, 'archived_sessions'), 1);
  return files;
}

async function listImports(env, res) {
  const state = await readState(env);
  sendJson(res, 200, { ok: true, imports: state.imports });
}

/* ---------------------------------------------------------------- locate --- */

function parseThreadRef(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) throw bad('请粘贴对话深度链接或线程 ID');
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!match) throw bad('没有识别到对话线程 ID，请检查链接是否完整');
  return match[0].toLowerCase();
}

async function locateRollout(codexHome, threadId) {
  const roots = [path.join(codexHome, 'sessions'), path.join(codexHome, 'archived_sessions')];
  for (const root of roots) {
    const hits = await collectCandidates(root, threadId, 4);
    if (!hits.length) continue;
    hits.sort((left, right) => {
      const plain = Number(right.name.endsWith('.jsonl')) - Number(left.name.endsWith('.jsonl'));
      if (plain !== 0) return plain;
      return right.mtime - left.mtime;
    });
    return hits[0];
  }
  return null;
}

async function collectCandidates(dir, needle, depth) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const hits = [];
  const dirs = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.includes(needle)) {
      let mtime = 0;
      try {
        mtime = (await fsp.stat(full)).mtimeMs;
      } catch {
        /* ignore */
      }
      hits.push({ file: full, name: entry.name, mtime });
    } else if (entry.isDirectory() && depth > 0) {
      dirs.push(full);
    }
  }
  if (hits.length) return hits;
  for (const sub of dirs) {
    const found = await collectCandidates(sub, needle, depth - 1);
    if (found.length) return found;
  }
  return [];
}

async function readRolloutText(file) {
  const buffer = await fsp.readFile(file);
  const looksCompressed =
    file.endsWith('.zst') ||
    file.endsWith('.zstd') ||
    (buffer.length > 3 && buffer[0] === 0x28 && buffer[1] === 0xb5 && buffer[2] === 0x2f && buffer[3] === 0xfd);
  if (!looksCompressed) return buffer.toString('utf8');
  if (typeof zlib.zstdDecompressSync === 'function') {
    return zlib.zstdDecompressSync(buffer).toString('utf8');
  }
  const binary = await findZstdBinary();
  if (!binary) throw bad('这段对话的记录是压缩格式，但当前环境缺少解压能力');
  const { stdout } = await execFileAsync(binary, ['-dc', file], { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' });
  return stdout;
}

async function findZstdBinary() {
  const candidates = ['/opt/homebrew/bin/zstd', '/usr/local/bin/zstd', '/usr/bin/zstd'];
  for (const candidate of candidates) {
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/* ---------------------------------------------------------------- parse --- */

function toMillis(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (value > 1e12) return Math.round(value);
  if (value > 1e9) return Math.round(value * 1000);
  return null;
}

function parseRollout(text) {
  const meta = { threadId: null, cwd: null, roots: [], createdAt: null, model: null, cliVersion: null };
  const turns = new Map();
  const tokenCounts = [];
  const order = [];
  let ordinal = 0;

  const ensureTurn = (turnId) => {
    if (!turnId) return null;
    let turn = turns.get(turnId);
    if (!turn) {
      turn = { turnId, order: order.length, startTime: null, endTime: null, status: 'unknown', items: [], responses: [] };
      turns.set(turnId, turn);
      order.push(turnId);
    }
    return turn;
  };

  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    ordinal += 1;
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      continue;
    }
    const lineTime = record.timestamp ? Date.parse(record.timestamp) : null;

    if (record.type === 'event_msg' && record.payload && record.payload.type === 'token_count') {
      const usage = record.payload.info && record.payload.info.last_token_usage;
      if (usage) tokenCounts.push({ time: lineTime, usage });
      continue;
    }

    if (record.type === 'session_meta') {
      const payload = record.payload || {};
      meta.threadId = payload.thread_id || payload.id || payload.session_id || meta.threadId;
      meta.cwd = payload.cwd || meta.cwd;
      meta.roots = Array.isArray(payload.runtime_workspace_roots) ? payload.runtime_workspace_roots : meta.roots;
      meta.createdAt = (payload.timestamp && Date.parse(payload.timestamp)) || lineTime || meta.createdAt;
      meta.cliVersion = payload.cli_version || meta.cliVersion;
      continue;
    }

    if (record.type === 'turn_context') {
      const payload = record.payload || {};
      const turn = ensureTurn(payload.turn_id || payload.root_turn_id);
      const started = toMillis(payload.started_at) ?? lineTime;
      if (turn && started && (turn.startTime == null || started < turn.startTime)) turn.startTime = started;
      continue;
    }

    if (record.type === 'event_msg') {
      const payload = record.payload || {};
      if (payload.type === 'task_started') {
        const turn = ensureTurn(payload.turn_id);
        const started = toMillis(payload.started_at) ?? lineTime;
        if (turn && started && (turn.startTime == null || started < turn.startTime)) turn.startTime = started;
        if (turn && turn.startTime == null) turn.startTime = lineTime;
        continue;
      }
      if (payload.type === 'task_complete') {
        const turn = ensureTurn(payload.turn_id);
        if (turn) {
          turn.status = 'completed';
          turn.endTime = toMillis(payload.completed_at) ?? toMillis(payload.completed_at_ms) ?? lineTime ?? turn.endTime;
          if (payload.last_agent_message) turn.lastAgentMessage = String(payload.last_agent_message);
        }
        continue;
      }
      if (payload.type === 'turn_aborted') {
        const turn = ensureTurn(payload.turn_id);
        if (turn) {
          turn.status = 'aborted';
          turn.endTime = toMillis(payload.completed_at) ?? lineTime ?? turn.endTime;
        }
        continue;
      }
      if (payload.type === 'thread_settings_applied') {
        const settings = payload.thread_settings || {};
        if (settings.model) meta.model = String(settings.model);
        continue;
      }
      if (payload.type === 'item_completed') {
        const item = payload.item;
        if (!item || typeof item !== 'object') continue;
        const turn = ensureTurn(payload.turn_id);
        if (!turn) continue;
        turn.items.push({
          ordinal,
          lineTime,
          startTime: toMillis(payload.started_at_ms) ?? toMillis(payload.started_at) ?? lineTime,
          endTime: toMillis(payload.completed_at_ms) ?? lineTime,
          item,
        });
        continue;
      }
      continue;
    }

    if (record.type === 'response_item') {
      const payload = record.payload || {};
      const turnId = payload.internal_chat_message_metadata_passthrough?.turn_id;
      const turn = ensureTurn(turnId);
      if (!turn) continue;
      turn.responses.push({ ordinal, lineTime, payload });
    }
  }

  const normalizedTurns = order.map((turnId, index) => normalizeTurn(turns.get(turnId), index));

  // Codex emits extra turns triggered by ambient UI state or an assistant
  // follow-up. Harness turns always start from a user message, so fold
  // promptless turns into the previous turn instead of showing the assistant
  // talking to itself.
  const parsedTurns = [];
  for (const turn of normalizedTurns) {
    if (!turn.prompts.length && !turn.steps.length) continue;
    if (!turn.prompts.length && parsedTurns.length) {
      const previous = parsedTurns[parsedTurns.length - 1];
      previous.steps.push(...turn.steps);
      previous.endTime = turn.endTime ?? previous.endTime;
      previous.status = turn.status;
      continue;
    }
    parsedTurns.push(turn);
  }
  parsedTurns.forEach((turn, index) => {
    turn.index = index;
  });

  // Attach the per-call token usage recorded by Codex (one `token_count` event
  // per model request) to the step it belongs to, in order.
  let tokenIndex = 0;
  for (const turn of parsedTurns) {
    for (const step of turn.steps) {
      const stepTime = typeof step.time === 'number' ? step.time : 0;
      while (tokenIndex < tokenCounts.length && (tokenCounts[tokenIndex].time ?? 0) < stepTime) tokenIndex += 1;
      if (tokenIndex >= tokenCounts.length) break;
      const usage = tokenCounts[tokenIndex].usage || {};
      step.usage = {
        inputTokens: Number(usage.input_tokens) || 0,
        outputTokens: Number(usage.output_tokens) || 0,
        totalTokens: Number(usage.total_tokens) || 0,
        cacheReadTokens: Number(usage.cached_input_tokens) || 0,
        cacheWriteTokens: Number(usage.cache_write_input_tokens) || 0,
        reasoningTokens: Number(usage.reasoning_output_tokens) || 0,
      };
      tokenIndex += 1;
    }
  }

  const first = parsedTurns.find((turn) => turn.startTime) || null;
  meta.createdAt = meta.createdAt || (first ? first.startTime : Date.now());
  if (!meta.cwd) meta.cwd = inferCwd(parsedTurns) || os.homedir();

  return {
    meta,
    turns: parsedTurns,
    stats: {
      turns: parsedTurns.length,
      prompts: parsedTurns.reduce((sum, turn) => sum + turn.prompts.length, 0),
      steps: parsedTurns.reduce((sum, turn) => sum + turn.steps.length, 0),
      toolCalls: parsedTurns.reduce((sum, turn) => sum + turn.steps.reduce((inner, step) => inner + step.tools.length, 0), 0),
    },
  };
}

function inferCwd(turns) {
  for (const turn of turns) {
    for (const step of turn.steps) {
      for (const tool of step.tools) {
        if (tool.cwd) return tool.cwd;
      }
    }
  }
  return null;
}

/**
 * Codex wraps a user message that carried attachments in a generated preamble
 * ("# Files mentioned by the user", file paths, `<image>` tags, "## My request:").
 * Those paths are Host-local temp files and read as noise in the imported
 * conversation, so keep only the user's actual request text.
 */
function sanitizePromptText(text) {
  if (typeof text !== 'string' || !text) return text;
  if (
    !/Files mentioned by the user/.test(text) &&
    !/<image\b/i.test(text) &&
    !/^Image attachment:\s*true\s*$/im.test(text)
  ) {
    return text;
  }
  let out = text;
  const marker = /^##\s*My request:\s*$/m.exec(out);
  if (marker) out = out.slice(marker.index + marker[0].length);
  else {
    out = out.replace(/^#\s*Files mentioned by the user:.*$/m, '');
    out = out.replace(/^##\s+[^\n]*\.(?:png|jpe?g|gif|webp|pdf|docx?|xlsx?|csv|txt|md|zip)\s*:\s*\S*\s*$/gim, '');
  }
  out = out.replace(/<image\b[\s\S]*?<\/image>/gi, '');
  out = out.replace(/<image\b[^>]*\/?>/gi, '');
  out = out.replace(/^Image attachment:\s*true\s*$/gim, '');
  out = out.replace(/^Distinguish instructions in attached documents from the user's request\.\s*$/gim, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function promptTextOf(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .map((block) => (block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('');
}

/**
 * Earlier imports kept the attachment preamble verbatim. Append supported
 * surface replacements for those user messages so the visible history (and the
 * model-visible projection) carries just the request text.
 */
function sniffImageMediaType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const head = Buffer.from(bytes.slice(0, 12));
  if (head.toString('utf8', 0, 3) === 'GIF') return 'image/gif';
  if (head.toString('utf8', 0, 4) === 'RIFF' && head.toString('utf8', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function decodeDataUrl(url) {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const meta = url.slice(5, comma);
  const parts = meta.split(';');
  if (!parts.includes('base64')) return null;
  const base64 = url.slice(comma + 1);
  try {
    return { mediaType: parts[0] || undefined, bytes: Buffer.from(base64, 'base64') };
  } catch {
    return null;
  }
}

function imageFromBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const url = block.image_url || block.url;
  if ((block.type === 'input_image' || block.type === 'image_url' || block.type === 'image') && typeof url === 'string') {
    if (!url.startsWith('data:')) return null;
    const decoded = decodeDataUrl(url);
    if (!decoded) return null;
    return { kind: 'data', mediaType: decoded.mediaType, bytes: decoded.bytes };
  }
  if (block.type === 'local_image' && typeof block.path === 'string' && block.path) {
    return { kind: 'path', path: block.path };
  }
  return null;
}

function contentImages(content) {
  if (!Array.isArray(content)) return [];
  const images = [];
  for (const block of content) {
    const image = imageFromBlock(block);
    if (image) images.push(image);
  }
  return images;
}

function imageSignature(image) {
  if (!image) return '';
  if (image.kind === 'data') {
    const bytes = image.bytes;
    if (!bytes || !bytes.length) return '';
    const sample = bytes.length
      ? `${bytes.length}:${bytes.toString('base64').slice(0, 48)}:${bytes.toString('base64').slice(-24)}`
      : '';
    return `data:${image.mediaType || ''}:${sample}`;
  }
  if (image.kind === 'path') return `path:${image.path}`;
  return '';
}

function addPromptImage(prompt, image) {
  const signature = imageSignature(image);
  if (!signature || prompt.imageKeys.has(signature)) return;
  if (image.kind === 'path' && prompt.images.some((item) => item.kind === 'data')) return;
  if (image.kind === 'data') {
    prompt.images = prompt.images.filter((item) => item.kind === 'data');
    prompt.imageKeys = new Set(prompt.images.map(imageSignature));
  }
  prompt.imageKeys.add(signature);
  prompt.images.push(image);
}

/**
 * Persist prompt images into the Harness attachment store and rewrite each
 * prompt's descriptors into `image` content blocks. Only images the user
 * attached are imported; tool-output screenshots stay text-only to keep the
 * imported session close to the conversation size.
 */
async function persistPromptImages(ctx, turns) {
  let attachments = null;
  try {
    attachments = ctx.get('attachments');
  } catch {
    attachments = null;
  }
  if (!attachments || typeof attachments.saveImage !== 'function') return 0;
  let saved = 0;
  for (const turn of turns || []) {
    for (const step of turn.steps || []) {
      for (const tool of step.tools || []) {
        const images = Array.isArray(tool.images) ? tool.images : [];
        if (!images.length) continue;
        const blocks = [];
        for (const image of images) {
          try {
            let bytes = image.bytes;
            let mediaType = image.mediaType;
            let name;
            if (image.kind === 'path') {
              bytes = await fsp.readFile(image.path);
              name = path.basename(image.path);
            }
            if (!bytes || !bytes.length) continue;
            mediaType = mediaType || sniffImageMediaType(bytes);
            if (!mediaType) continue;
            const ref = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType, name });
            blocks.push({ type: 'image', attachment: ref });
            saved += 1;
          } catch {
            /* skip images the store refuses */
          }
        }
        tool.imageBlocks = blocks;
        delete tool.images;
      }
    }
    for (const prompt of turn.prompts || []) {
      const images = prompt.images || [];
      if (!images.length) continue;
      const blocks = [];
      for (const image of images) {
        try {
          let bytes = image.bytes;
          let mediaType = image.mediaType;
          let name;
          if (image.kind === 'path') {
            bytes = await fsp.readFile(image.path);
            name = path.basename(image.path);
          }
          if (!bytes || !bytes.length) continue;
          mediaType = mediaType || sniffImageMediaType(bytes);
          if (!mediaType) continue;
          const ref = await attachments.saveImage({
            data: new Uint8Array(bytes),
            mediaType,
            name,
          });
          blocks.push({ type: 'image', attachment: ref });
          saved += 1;
        } catch {
          /* skip images the store refuses; keep the text prompt */
        }
      }
      prompt.images = blocks;
    }
  }
  return saved;
}

function normalizeTurn(turn, index) {
  const items = [...turn.items].sort((left, right) => left.ordinal - right.ordinal);
  const combined = [
    ...items.map((entry) => ({ kind: 'item', ...entry })),
    ...turn.responses.map((entry) => ({ kind: 'response', ...entry })),
  ].sort((left, right) => left.ordinal - right.ordinal);

  const prompts = [];
  const promptIndexByKey = new Map();
  for (const entry of combined) {
    const isItemUser = entry.kind === 'item' && entry.item.type === 'UserMessage';
    const isResponseUser =
      entry.kind === 'response' && entry.payload.type === 'message' && entry.payload.role === 'user';
    if (!isItemUser && !isResponseUser) continue;
    const content = isItemUser ? entry.item.content : entry.payload.content;
    const rawText = contentText(content);
    const normalized = rawText ? sanitizePromptText(normalizePrompt(rawText)) : '';
    const images = contentImages(content);
    if (!normalized && !images.length) continue;
    const key = normalized
      ? normalized.replace(/\s+/g, ' ').slice(0, 240)
      : `image:${images.map(imageSignature).sort().join('|')}`;
    let prompt = prompts[promptIndexByKey.get(key)];
    if (!prompt) {
      prompt = {
        text: normalized,
        images: [],
        imageKeys: new Set(),
        time: entry.startTime ?? entry.lineTime ?? null,
      };
      promptIndexByKey.set(key, prompts.length);
      prompts.push(prompt);
    }
    for (const image of images) addPromptImage(prompt, image);
    if (!prompt.text && !prompt.images.length) {
      prompts.pop();
      promptIndexByKey.delete(key);
    }
  }
  for (const prompt of prompts) delete prompt.imageKeys;
  prompts.sort((left, right) => (left.time ?? 0) - (right.time ?? 0));

  const steps = [];
  let current = null;
  let pendingReasoning = '';
  const flush = () => {
    if (current && (current.text || current.tools.length || current.reasoning)) steps.push(current);
    current = null;
  };
  const ensure = (entry) => {
    if (!current) {
      current = {
        text: '',
        reasoning: '',
        tools: [],
        time: entry.startTime ?? entry.lineTime ?? null,
        endTime: entry.endTime ?? entry.lineTime ?? null,
      };
    }
    return current;
  };

  // Agent-team / REPL tool calls live in response_item records rather than
  // item_completed; pair each call with its output and merge it into a step.
  const functionOutputs = new Map();
  for (const entry of turn.responses) {
    const payload = entry.payload || {};
    if (payload.type === 'function_call_output' && payload.call_id) {
      const blocks = Array.isArray(payload.output) ? payload.output : [];
      const text = blocks
        .filter((block) => block && block.type === 'input_text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
      functionOutputs.set(payload.call_id, {
        text: typeof payload.output === 'string' ? payload.output : text,
        time: entry.lineTime ?? null,
      });
    }
  }
  const extraTools = [];
  const functionCallIds = new Set();
  for (const entry of turn.responses) {
    const payload = entry.payload || {};
    if (payload.type !== 'function_call') continue;
    if (payload.call_id) functionCallIds.add(payload.call_id);
    const output = functionOutputs.get(payload.call_id);
    let args = {};
    try {
      args = payload.arguments ? JSON.parse(payload.arguments) : {};
    } catch {
      args = { raw: String(payload.arguments) };
    }
    let name = payload.name || 'tool';
    if (name === 'sleep') {
      const seconds = Math.max(0, Math.round((Number(args.duration_ms) || 0) / 1000));
      name = 'bash';
      args = { command: `sleep ${seconds}` };
    }
    extraTools.push({
      name,
      args,
      result: truncate(output ? output.text : '', MAX_OUTPUT_CHARS),
      isError: false,
      time: entry.lineTime ?? null,
      endTime: output ? output.time ?? entry.lineTime ?? null : entry.lineTime ?? null,
    });
  }

  for (const entry of items) {
    const item = entry.item;
    if (item.type === 'Reasoning') {
      const text = Array.isArray(item.summary_text) ? item.summary_text.join('\n\n').trim() : '';
      if (text) {
        if (current && (current.text || current.tools.length)) flush();
        pendingReasoning = pendingReasoning ? `${pendingReasoning}\n\n${text}` : text;
      }
      continue;
    }
    if (item.type === 'AgentMessage') {
      const text = sanitizeText(contentText(item.content));
      if (!text) continue;
      if (current && (current.text || current.tools.length)) flush();
      const step = ensure(entry);
      if (pendingReasoning) {
        step.reasoning = pendingReasoning;
        pendingReasoning = '';
      }
      step.text = text;
      step.time = entry.startTime ?? entry.lineTime ?? step.time;
      continue;
    }
    const tools = convertTools(entry, functionCallIds);
    if (!tools.length) continue;
    const step = ensure(entry);
    if (pendingReasoning) {
      step.reasoning = pendingReasoning;
      pendingReasoning = '';
    }
    for (const tool of tools) step.tools.push(tool);
  }
  flush();

  for (const tool of extraTools) {
    let target = steps.length ? steps[0] : null;
    for (const step of steps) {
      if ((tool.time ?? 0) >= (step.time ?? 0)) target = step;
    }
    if (!target) continue;
    target.tools.push(tool);
    target.tools.sort((left, right) => (left.time ?? 0) - (right.time ?? 0));
    if (typeof tool.endTime === 'number' && (!target.endTime || tool.endTime > target.endTime)) {
      target.endTime = tool.endTime;
    }
  }

  const startTime =
    turn.startTime ??
    (prompts.length ? prompts[0].time : null) ??
    (steps.length ? steps[0].time : null) ??
    null;
  const endTime =
    turn.endTime ??
    (steps.length ? steps[steps.length - 1].endTime ?? steps[steps.length - 1].time : null) ??
    startTime;

  return {
    index,
    turnId: turn.turnId,
    status: turn.status === 'aborted' ? 'aborted' : turn.status === 'completed' ? 'completed' : 'incomplete',
    startTime,
    endTime,
    prompts,
    steps,
    lastAgentMessage: turn.lastAgentMessage ? sanitizeText(turn.lastAgentMessage) : null,
  };
}

function contentText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      if (typeof block.text === 'string') return block.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

const AMBIENT_PREFIXES = [
  '<in-app-browser-context',
  '<environment_context>',
  '<external_codex',
  '<codex_apps',
  '<multi_agent',
  '<app-context>',
  '<user_instructions',
  '<skills_instructions',
  '<tools>',
  '<permissions',
  '<turn_context',
  '# AGENTS.md instructions',
];

function normalizePrompt(text) {
  let value = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!value) return null;
  if (AMBIENT_PREFIXES.some((prefix) => value.startsWith(prefix))) return null;
  if (value.startsWith('<send_user_message_question_reply>')) {
    const answers = parseQuestionReply(value);
    return answers ? sanitizeText(answers) : null;
  }
  if (/^<[a-z_\-]+>[\s\S]*<\/[a-z_\-]+>$/.test(value) && value.length < 20000) {
    const inner = value.replace(/^<[^>]+>|<\/[^>]+>$/g, '').trim();
    if (!inner || /^(true|false|null|\{.*\})$/.test(inner)) return null;
    return sanitizeText(inner);
  }
  if (value.startsWith('Message Type:') || value.includes('\nTask name: ')) return null;
  if (!value.replace(/[\s<>{}\[\]()"'`*_#-]/g, '')) return null;
  return sanitizeText(value);
}

function parseQuestionReply(text) {
  const start = text.indexOf('[');
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(start));
    if (!Array.isArray(parsed)) return null;
    const answers = parsed
      .map((entry) => (entry && typeof entry.answer === 'string' ? entry.answer.trim() : ''))
      .filter(Boolean);
    return answers.length ? answers.join('\n') : null;
  } catch {
    return null;
  }
}

function sanitizeText(text) {
  if (!text) return '';
  let value = String(text);
  value = value.replace(/:codex-[a-z-]+\{[^}]*\}/g, '');
  value = value.replace(/:codex-[a-z-]+\{/g, '');
  value = value.replace(/\r\n/g, '\n');
  value = value.replace(/[ \t]+\n/g, '\n');
  value = value.trim();
  if (!value) return '';
  if (value.startsWith('Message Type:') || /^Sender: .*\nPayload:/m.test(value)) return '';
  return value;
}

const REBRAND_PATTERN = /codex/gi;

function rebrandText(text) {
  if (!text) return text;
  return String(text)
    .replace(/([\u4e00-\u9fff])\s+codex\s+/gi, '$1本地助手')
    .replace(REBRAND_PATTERN, '本地助手');
}

function fileUrlToPath(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(url).pathname);
    } catch {
      return null;
    }
  }
  return url.startsWith('/') ? url : null;
}

function truncate(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : value.slice(0, max);
}

function jsonArguments(value) {
  if (typeof value === 'string') return { raw: value };
  if (value && typeof value === 'object') return value;
  return {};
}

function nativeWriteResult(filePath) {
  return `<path>${filePath}</path>\n<type>file</type>\n<content>\nCreated file\n</content>`;
}

function nativeEditResult(filePath) {
  return `The file ${filePath} has been updated successfully.`;
}

function diffHunks(diff) {
  const lines = String(diff ?? '').split('\n');
  const hunks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { oldLines: [], newLines: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('\\')) continue;
    if (line.startsWith(' ')) {
      current.oldLines.push(line.slice(1));
      current.newLines.push(line.slice(1));
    } else if (line.startsWith('-')) current.oldLines.push(line.slice(1));
    else if (line.startsWith('+')) current.newLines.push(line.slice(1));
  }
  if (current) hunks.push(current);
  return hunks
    .filter((hunk) => hunk.oldLines.length || hunk.newLines.length)
    .map((hunk) => ({
      oldText: truncate(hunk.oldLines.join('\n'), MAX_FILE_CHARS),
      newText: truncate(hunk.newLines.join('\n'), MAX_FILE_CHARS),
    }));
}

function convertTools(entry, skipMcpIds) {
  const item = entry.item;
  const time = entry.startTime ?? entry.lineTime ?? null;
  const endTime = entry.endTime ?? (time != null ? time + 1 : null);
  if (item.type === 'CommandExecution') return [convertCommand(item, entry, time, endTime)];
  if (item.type === 'FileChange') return convertFileChanges(item, time, endTime);
  if (item.type === 'Extension') return convertExtension(item, time, endTime);
  if (item.type === 'ImageView') {
    const raw = typeof item.path === 'string' ? item.path : '';
    const filePath = fileUrlToPath(raw) || raw;
    if (!filePath) return [];
    return [{
      name: 'read_image',
      args: { file_path: filePath },
      result: `<path>${filePath}</path>`,
      images: [{ kind: 'path', path: filePath }],
      isError: false,
      time,
      endTime,
    }];
  }
  if (item.type === 'McpToolCall') {
    if (skipMcpIds && skipMcpIds.has(item.id)) return [];
    return convertMcpTool(item, time, endTime);
  }
  return [];
}

function convertCommand(item, entry, time, endTime) {
  const argv = Array.isArray(item.command) ? item.command : [];
  let command = '';
  if (argv.length >= 3 && /(?:^|\/)(?:zsh|bash|sh|fish)$/.test(String(argv[0]))) {
    command = String(argv[argv.length - 1]);
  } else if (argv.length) {
    command = String(argv[argv.length - 1]);
  } else if (typeof item.command === 'string') {
    command = item.command;
  }
  const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
  const cwd = fileUrlToPath(item.cwd);
  return {
    name: 'bash',
    args: { command: truncate(command, MAX_COMMAND_CHARS) },
    result: truncate(output, MAX_OUTPUT_CHARS),
    isError: typeof item.exit_code === 'number' && item.exit_code !== 0,
    cwd,
    time,
    endTime,
  };
}

function convertFileChanges(item, time, endTime) {
  const changes = item.changes && typeof item.changes === 'object' ? Object.entries(item.changes) : [];
  const tools = [];
  for (const [filePath, change] of changes) {
    if (!change || typeof change !== 'object') continue;
    if (change.type === 'add') {
      const content = String(change.content ?? '');
      tools.push({
        name: 'write',
        args: { file_path: filePath, content: truncate(content, MAX_FILE_CHARS) },
        result: nativeWriteResult(filePath),
        isError: false,
        time,
        endTime,
      });
    } else if (change.type === 'update' && typeof change.unified_diff === 'string') {
      for (const hunk of diffHunks(change.unified_diff)) {
        tools.push({
          name: 'edit',
          args: { file_path: filePath, old_string: hunk.oldText, new_string: hunk.newText },
          result: nativeEditResult(filePath),
          isError: false,
          time,
          endTime,
        });
      }
    }
  }
  return tools;
}

function convertMcpTool(item, time, endTime) {
  if (item.status && item.status !== 'completed') return [];
  const server = item.server || 'mcp';
  const tool = item.tool || 'tool';
  const content = item.result && Array.isArray(item.result.content) ? item.result.content : [];
  const text = content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n');
  const duration = item.duration && typeof item.duration === 'object'
    ? Math.max(1, Math.round((Number(item.duration.secs) || 0) * 1000 + (Number(item.duration.nanos) || 0) / 1e6))
    : null;
  return [{
    name: `mcp__${server}__${tool}`,
    args: jsonArguments(item.arguments),
    result: truncate(text, MAX_OUTPUT_CHARS),
    isError: Boolean(item.result && item.result.isError),
    time,
    endTime: duration !== null && typeof time === 'number' ? time + duration : endTime,
  }];
}

function functionCallTool(entry) {
  const payload = entry.payload || {};
  if (payload.type !== 'function_call') return null;
  const name = payload.name || 'tool';
  let args = {};
  try {
    args = payload.arguments ? JSON.parse(payload.arguments) : {};
  } catch {
    args = { raw: String(payload.arguments) };
  }
  return {
    name,
    args,
    output: payload.call_id,
    time: entry.lineTime ?? null,
    endTime: entry.lineTime ?? null,
  };
}

function firstDiffHunk(diff) {
  const lines = String(diff).split('\n');
  const oldLines = [];
  const newLines = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (inHunk) break;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('-')) oldLines.push(line.slice(1));
    else if (line.startsWith('+')) newLines.push(line.slice(1));
  }
  return {
    oldText: truncate(oldLines.join('\n'), 4000),
    newText: truncate(newLines.join('\n'), 4000),
  };
}

function convertExtension(item, time, endTime) {
  const action = item.action && typeof item.action === 'object' ? item.action : {};
  const resultText = summarizeExtensionResults(item.results);
  if (item.kind === 'web.search' && action.type === 'openPage' && action.url) {
    return [{ name: 'web_fetch', args: { url: action.url }, result: resultText, isError: false, time, endTime }];
  }
  if (item.kind === 'web.search') {
    const query = item.query || action.query || '';
    return [{ name: 'web_search', args: { queries: [String(query)] }, result: resultText, isError: false, time, endTime }];
  }
  if (item.kind === 'clock.sleep') {
    const seconds = Math.max(0, Math.round((Number(item.durationMs) || 0) / 1000));
    return [{ name: 'bash', args: { command: `sleep ${seconds}` }, result: '', isError: false, time, endTime }];
  }
  return [];
}

function summarizeExtensionResults(results) {
  if (!Array.isArray(results)) return '';
  return truncate(
    results
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const title = entry.title ? `## ${entry.title}\n` : '';
        const text = entry.text || entry.snippet || '';
        return `${title}${text}`.trim();
      })
      .filter(Boolean)
      .join('\n\n'),
    6000,
  );
}

/* ---------------------------------------------------------------- events --- */

function buildEvents(parsed, options) {
  const events = [];
  const append = options.append === true;
  let seq = Number.isInteger(options.seqStart) ? options.seqStart : 0;
  let lastTime = Number.isInteger(options.timeFloor) ? options.timeFloor : 0;
  const messageId = () => crypto.randomUUID();
  const callId = () => `call_${crypto.randomUUID().replace(/-/g, '')}`;
  const push = (type, data, time, extra) => {
    let value = typeof time === 'number' && Number.isFinite(time) ? Math.round(time) : lastTime + 1;
    if (value <= lastTime) value = lastTime + 1;
    lastTime = value;
    const event = { type, seq: seq, time: value, data };
    if (extra) Object.assign(event, extra);
    seq += 1;
    events.push(event);
    return event;
  };

  if (!append) {
    const start = parsed.turns.length && parsed.turns[0].startTime ? parsed.turns[0].startTime : parsed.meta.createdAt;
    const base = typeof start === 'number' ? start - 1000 : Date.now();
    push('permission/preset', { preset: 'workspace-write' }, base);
    push('sandbox/mode', { mode: 'workspace-write' }, base);
    push('approval/policy', { policy: 'ask' }, base);
  }

  const turns = options.turns || (options.maxTurns > 0 ? parsed.turns.slice(-options.maxTurns) : parsed.turns);
  let titleWritten = append;
  const turnBase = Number.isInteger(options.turnStart) ? options.turnStart : 1;

  turns.forEach((turn, turnIndex) => {
    const turnNumber = turnBase + turnIndex;
    let turnStart = Math.round(
      turn.startTime ?? (turn.prompts.length ? turn.prompts[0].time : null) ?? lastTime + 1,
    );
    if (!Number.isFinite(turnStart) || turnStart <= lastTime) turnStart = lastTime + 1;
    // Keep each turn's events inside its own source window so merged ambient
    // steps cannot stretch or collapse the displayed duration.
    const rawEnd = Math.round(turn.endTime ?? turnStart);
    let turnEnd = Math.max(rawEnd, turnStart + 1000, lastTime + 1000);
    const inTurn = (time) => {
      const value = typeof time === 'number' && Number.isFinite(time) ? Math.round(time) : turnStart;
      return Math.min(Math.max(value, turnStart), turnEnd - 1);
    };
    push('turn/start', { turn: turnNumber }, turnStart);

    const steps = turn.steps.length ? turn.steps : [{ text: '', tools: [], time: turnStart, endTime: turnStart }];
    steps.forEach((step, stepIndex) => {
      const stepNumber = stepIndex + 1;
      const stepTime = inTurn(step.time);
      push('step/start', { turn: turnNumber, step: stepNumber }, stepTime);

      if (stepIndex === 0) {
        for (const prompt of turn.prompts) {
          if (options.rebrandText) prompt.text = rebrandText(prompt.text);
          const content = [];
          if (prompt.text) content.push({ type: 'text', text: prompt.text });
          for (const image of prompt.images || []) {
            if (image && image.attachment) content.push({ type: 'image', attachment: image.attachment });
          }
          if (!content.length) continue;
          const event = push(
            'user/message',
            {
              content,
              source: { kind: 'user' },
              role: 'user',
              id: messageId(),
            },
            inTurn(prompt.time),
            { surfaceOp: 'append' },
          );
          if (!titleWritten) {
            push(
              'session/title',
              { title: options.title, messageSeqs: [event.seq], source: { kind: 'fallback' } },
              inTurn(prompt.time),
            );
            titleWritten = true;
          }
        }
      }

      const tools = options.includeToolCalls ? step.tools : [];
      const content = [];
      if (step.reasoning) {
        content.push({ type: 'reasoning', text: options.rebrandText ? rebrandText(step.reasoning) : step.reasoning });
      }
      if (step.text) content.push({ type: 'text', text: options.rebrandText ? rebrandText(step.text) : step.text });
      const callIds = tools.map(() => callId());
      tools.forEach((tool, index) => {
        content.push({
          type: 'tool-call',
          id: callIds[index],
          name: tool.name,
          arguments: JSON.stringify(tool.args),
        });
      });
      if (content.length) {
        push(
          'assistant/message',
          {
            turn: turnNumber,
            step: stepNumber,
            message: {
              role: 'assistant',
              content,
              source: { kind: 'model', provider: options.provider, model: options.model },
              id: messageId(),
            },
            stream: [],
            ...(step.usage ? { usage: step.usage } : {}),
          },
          stepTime,
          { surfaceOp: 'append' },
        );
      }
      tools.forEach((tool, index) => {
        push(
          'tool/call',
          {
            turn: turnNumber,
            step: stepNumber,
            callId: callIds[index],
            name: tool.name,
            arguments: JSON.stringify(tool.args),
          },
          inTurn(tool.time),
        );
      });
      tools.forEach((tool, index) => {
        const toolContent = [];
        const toolText = tool.result || '';
        if (toolText) toolContent.push({ type: 'text', text: toolText });
        for (const block of tool.imageBlocks || []) toolContent.push(block);
        if (!toolContent.length) toolContent.push({ type: 'text', text: '' });
        const data = {
          turn: turnNumber,
          step: stepNumber,
          message: {
            role: 'tool',
            source: { kind: 'tool', callId: callIds[index] },
            toolCallId: callIds[index],
            content: toolContent,
            id: messageId(),
          },
        };
        if (tool.isError) {
          data.message.isError = true;
          data.error = { name: 'CommandFailed', code: 'tool/nonzero-exit', reason: '命令以非零状态退出' };
        }
        push('tool/result', data, inTurn(tool.endTime ?? tool.time), { surfaceOp: 'append' });
      });
      push('step/end', { turn: turnNumber, step: stepNumber }, inTurn(step.endTime ?? step.time));
    });

    const reason = turn.status === 'completed' ? { kind: 'completed' } : { kind: 'interrupted' };
    push('turn/end', { turn: turnNumber, reason }, turnEnd);
  });

  return events;
}

/* ---------------------------------------------------------------- import --- */

async function preview(ctx, env, body, res) {
  const threadId = parseThreadRef(body?.link);
  const loaded = await loadThread(env, threadId);
  const state = await readState(env);
  const previous = state.imports[threadId] || null;
  let alreadyImported = null;
  if (previous?.sessionId) {
    try {
      const snapshot = await ctx.sessionPersistence.stat(previous.sessionId);
      if (snapshot) alreadyImported = { sessionId: previous.sessionId, importedAt: previous.importedAt ?? null, title: previous.title ?? null };
    } catch {
      /* stale record */
    }
  }
  sendJson(res, 200, {
    ok: true,
    thread: describeThread(loaded),
    workspace: await describeWorkspace(ctx, loaded.parsed.meta.cwd),
    alreadyImported,
  });
}

async function importFromRequest(ctx, env, body, res) {
  sendJson(res, 200, await performImport(ctx, env, body));
}

async function performImport(ctx, env, body) {
  const threadId = parseThreadRef(body?.link);
  const loaded = await loadThread(env, threadId);
  const state = await readState(env);
  const previous = state.imports[threadId] || null;
  if (!body?.force && previous?.sessionId) {
    try {
      const snapshot = await ctx.sessionPersistence.stat(previous.sessionId);
      if (snapshot) {
        return {
          ok: true,
          alreadyImported: true,
          session: {
            sessionId: previous.sessionId,
            title: previous.title ?? loaded.title,
            cwd: loaded.parsed.meta.cwd,
            workspace: await describeWorkspace(ctx, loaded.parsed.meta.cwd),
          },
        };
      }
    } catch {
      /* stale record: import again */
    }
  }

  const includeToolCalls = body?.includeToolCalls !== false;
  const maxTurns = Number.isFinite(Number(body?.maxTurns)) ? Math.max(0, Math.floor(Number(body.maxTurns))) : 0;
  const rebrandEnabled = body?.rebrandText !== false;
  const rawTitle = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : loaded.title;
  const title = rebrandEnabled ? rebrandText(rawTitle) : rawTitle;

  // Only finished turns become events, so auto sync can append the tail once it finishes.
  const completed = loaded.parsed.turns.filter((turn) => turn.status === 'completed');
  const sourceTurns = completed.length ? completed : loaded.parsed.turns;
  const turns = maxTurns > 0 ? sourceTurns.slice(-maxTurns) : sourceTurns;
  await persistPromptImages(ctx, turns);
  const events = buildEvents(loaded.parsed, {
    title,
    includeToolCalls,
    rebrandText: rebrandEnabled,
    turns,
    append: false,
    turnStart: 1,
    seqStart: 0,
    timeFloor: 0,
    provider: PROVIDER,
    model: MODEL,
  });
  if (!events.length) throw bad('这段对话还没有可导入的内容');

  const sessionId = `session-${crypto.randomUUID()}`;
  const createdAt = events[0].time;
  const header = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt,
    cwd: loaded.parsed.meta.cwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'cordis',
  };

  const persistence = ctx.sessionPersistence;
  const handle = await persistence.create(header);
  try {
    for (let index = 0; index < events.length; index += APPEND_CHUNK) {
      await handle.append(events.slice(index, index + APPEND_CHUNK));
    }
    await handle.flush();
  } finally {
    await handle.close();
  }

  // The log format is validated on read, so prove the Session reopens before it
  // is announced in the sidebar; a rejected log is removed instead of lingering.
  try {
    const probe = await persistence.open(sessionId, 'read');
    try {
      await probe.read(0, 1);
    } finally {
      await probe.close();
    }
  } catch (error) {
    await removeStoredSession(loaded.parsed.meta.cwd, sessionId);
    throw httpError(500, `会话格式校验未通过：${error?.message || error}`);
  }

  const workspace = await attachWorkspace(ctx, loaded.parsed.meta.cwd, sessionId);
  let sourceMtime = 0;
  try {
    sourceMtime = (await fsp.stat(loaded.rollout.file)).mtimeMs;
  } catch {
    /* source may live on a volume that just went away */
  }
  state.imports[threadId] = {
    sessionId,
    title,
    importedAt: Date.now(),
    cwd: loaded.parsed.meta.cwd,
    rolloutFile: loaded.rollout.file,
    turns: turns.length,
    events: events.length,
    lastTime: events[events.length - 1].time,
    syncedTurns: sourceTurns.length,
    sourceMtime,
    includeToolCalls,
    rebrandText,
    sync: true,
    lastSyncAt: Date.now(),
    lastSyncResult: null,
  };
  await writeState(env, state);

  return {
    ok: true,
    alreadyImported: false,
    session: {
      sessionId,
      title,
      cwd: loaded.parsed.meta.cwd,
      workspace,
      events: events.length,
      turns: turns.length,
      pendingTurns: loaded.parsed.turns.length - turns.length,
      createdAt,
      sync: true,
      sessionId,
    },
    thread: describeThread(loaded),
  };
}

const cwdCache = new Map();

async function readRolloutCwd(fileEntry) {
  if (!fileEntry || !fileEntry.file) return null;
  const cached = cwdCache.get(fileEntry.file);
  if (cached && cached.mtime === fileEntry.mtime) return cached.cwd;
  try {
    let head = '';
    if (fileEntry.file.endsWith('.jsonl')) {
      const handle = await fsp.open(fileEntry.file, 'r');
      try {
        const buffer = Buffer.alloc(16384);
        const read = await handle.read(buffer, 0, buffer.length, 0);
        head = buffer.subarray(0, read.bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    } else {
      head = (await readRolloutText(fileEntry.file)).slice(0, 16384);
    }
    const line = head.split('\n').find((entry) => entry.includes('"session_meta"'));
    if (line) {
      let cwd = null;
      try {
        cwd = JSON.parse(line)?.payload?.cwd ?? null;
      } catch {
        // session_meta can exceed the read window because it carries the base
        // instructions; the working directory sits near its start.
        const match = line.match(/"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/);
        if (match) {
          try {
            cwd = JSON.parse(match[1]);
          } catch {
            cwd = null;
          }
        }
      }
      cwdCache.set(fileEntry.file, { mtime: fileEntry.mtime, cwd });
      return cwd;
    }
  } catch {
    /* fall through to unknown directory */
  }
  return null;
}

function summarizeImports(state) {
  return Object.fromEntries(
    Object.entries(state.imports).map(([id, record]) => [
      id,
      {
        sessionId: record.sessionId,
        title: record.title,
        turns: record.turns,
        sync: record.sync !== false,
        diverged: record.diverged === true,
        lastSyncAt: record.lastSyncAt ?? null,
        lastSyncResult: record.lastSyncResult ?? null,
      },
    ]),
  );
}

async function settingsRequest(env, body, res) {
  const state = await readState(env);
  if (typeof body?.autoSync === 'boolean') state.autoSync = body.autoSync;
  if (typeof body?.threadId === 'string' && typeof body?.sync === 'boolean') {
    const record = state.imports[body.threadId];
    if (!record) throw bad('还没有导入过这段对话');
    record.sync = body.sync;
    if (body.sync && record.diverged) record.approvedDiverged = true;
  }
  await writeState(env, state);
  sendJson(res, 200, {
    ok: true,
    settings: { autoSync: state.autoSync !== false, imports: summarizeImports(state) },
  });
}

async function syncRequest(ctx, env, body, res) {
  const state = await readState(env);
  if (typeof body?.autoSync === 'boolean') {
    state.autoSync = body.autoSync;
    await writeState(env, state);
  }
  const threadId = typeof body?.threadId === 'string' ? body.threadId : null;
  const entries = Object.entries(state.imports).filter(([, record]) => record && record.sessionId);
  const targets = threadId ? entries.filter(([id]) => id === threadId) : entries;
  if (threadId && !targets.length) throw bad('还没有导入过这段对话');
  const results = await runSync(ctx, env, state, targets, Boolean(body?.force));
  const appendedTurns = results.reduce((sum, item) => sum + (item.turns || 0), 0);
  sendJson(res, 200, {
    ok: true,
    sync: {
      autoSync: state.autoSync !== false,
      checked: results.length,
      appendedTurns,
      results: results.map((item) => ({
        threadId: item.threadId,
        sessionId: item.sessionId,
        skipped: item.skipped ?? null,
        turns: item.turns ?? 0,
        events: item.events ?? 0,
        error: item.error ?? null,
      })),
      imports: summarizeImports(state),
    },
  });
}

async function runSync(ctx, env, state, entries, force) {
  const results = [];
  for (const [threadId, record] of entries) {
    try {
      results.push(await syncOne(ctx, env, state, threadId, record, force));
    } catch (error) {
      record.lastSyncAt = Date.now();
      record.lastSyncResult = `失败：${error?.message || error}`;
      results.push({ threadId, sessionId: record.sessionId, error: String(error?.message || error) });
    }
  }
  await writeState(env, state);
  return results;
}

async function syncOne(ctx, env, state, threadId, record, force) {
  const result = { threadId, sessionId: record.sessionId };
  if (!force && record.sync === false) {
    result.skipped = 'disabled';
    return result;
  }
  if (!record.rolloutFile) {
    const located = await locateRollout(env.codexHome, threadId);
    if (!located) {
      result.skipped = 'no-source';
      return result;
    }
    record.rolloutFile = located.file;
  }
  let stat;
  try {
    stat = await fsp.stat(record.rolloutFile);
  } catch {
    result.skipped = 'source-missing';
    return result;
  }
  if (!force && record.sourceMtime && stat.mtimeMs === record.sourceMtime) {
    result.skipped = 'unchanged';
    return result;
  }

  // Prefer the live Session: an open conversation owns the log writer, so the
  // closed-log path could never append while the user is reading it. Appending
  // through the live Session also makes the new turns appear immediately.
  const sessions = safeService(ctx, 'sessions');
  const live = sessions && typeof sessions.get === 'function' ? sessions.get(record.sessionId) : undefined;
  let liveState = null;
  if (live) {
    liveState = liveTurnState(live);
    if (liveState.open) {
      result.skipped = 'session-busy';
      record.lastSyncAt = Date.now();
      record.lastSyncResult = '等待：会话正在生成，稍后自动同步';
      return result;
    }
  } else {
    // Cheap ownership probe first: a busy closed-log Session must not cost a
    // full rollout parse on every tick.
    let probe;
    try {
      probe = await ctx.sessionPersistence.open(record.sessionId, 'write');
    } catch {
      result.skipped = 'session-busy';
      record.lastSyncAt = Date.now();
      record.lastSyncResult = '等待：会话正在使用，稍后自动同步';
      return result;
    }
    await probe.close().catch(() => {});
  }

  if (!Number.isInteger(record.syncedTurns)) {
    const legacyTail = liveState
      ? { closedTurns: liveState.closedTurn }
      : await readSessionTail(ctx, record.sessionId);
    record.syncedTurns = legacyTail.closedTurns ?? 0;
    record.sync = record.sync !== false;
    record.includeToolCalls = record.includeToolCalls !== false;
    record.rebrandText = record.rebrandText !== false;
    try {
      record.sourceMtime = (await fsp.stat(record.rolloutFile)).mtimeMs;
    } catch {
      record.sourceMtime = 0;
    }
    result.skipped = 'initialized';
    return result;
  }

  // The stored turn count tracks how many turns this plugin contributed.
  const storedTail = liveState
    ? { lastTurn: liveState.closedTurn, closedTurns: liveState.closedTurn, lastTime: liveState.lastTime, nextSeq: live.seq }
    : await readSessionTail(ctx, record.sessionId);
  if (storedTail.error) {
    result.error = storedTail.error;
    return result;
  }

  // A conversation continued here diverges from its source; appending source
  // turns afterwards would interleave two story lines, so pause instead.
  const expectedTurns = Number.isInteger(record.turns) ? record.turns : storedTail.lastTurn;
  if (!force && record.approvedDiverged !== true && storedTail.lastTurn > expectedTurns) {
    record.sync = false;
    record.diverged = true;
    record.lastSyncAt = Date.now();
    record.lastSyncResult = '检测到本地续聊，已暂停自动同步';
    result.skipped = 'diverged';
    return result;
  }

  const text = await readRolloutText(record.rolloutFile);
  const parsed = parseRollout(text);
  const completed = parsed.turns.filter((turn) => turn.status === 'completed');
  const synced = Number.isInteger(record.syncedTurns) ? record.syncedTurns : 0;
  if (completed.length <= synced) {
    record.sourceMtime = stat.mtimeMs;
    record.lastSyncAt = Date.now();
    record.lastSyncResult = '已是最新';
    if (completed.length < synced) record.syncedTurns = completed.length;
    result.skipped = 'no-new-turns';
    return result;
  }
  const newTurns = completed.slice(synced);
  await persistPromptImages(ctx, newTurns);
  const buildOptions = {
    title: record.title,
    includeToolCalls: record.includeToolCalls !== false,
    rebrandText: record.rebrandText !== false,
    provider: PROVIDER,
    model: MODEL,
  };

  if (live) {
    let closedTurn = liveState.closedTurn;
    let appended = 0;
    let appendedEvents = 0;
    for (const turn of newTurns) {
      closedTurn += 1;
      const built = buildEvents(parsed, {
        ...buildOptions,
        turns: [turn],
        append: true,
        turnStart: closedTurn,
        seqStart: 0,
        timeFloor: liveState.lastTime,
      });
      try {
        for (const event of built) {
          if (event.surfaceOp) live.append(event.type, event.data, { surfaceOp: event.surfaceOp });
          else live.append(event.type, event.data);
        }
      } catch (error) {
        result.error = `追加到打开中的会话失败：${error?.message || error}`;
        break;
      }
      appended += 1;
      appendedEvents += built.length;
      record.syncedTurns = synced + appended;
      record.turns = (record.turns || 0) + 1;
      record.events = (record.events || 0) + built.length;
    }
    if (appended) {
      try {
        await ctx.sessions.flush(live);
      } catch {
        /* durability is best effort */
      }
      record.sourceMtime = stat.mtimeMs;
      record.lastSyncAt = Date.now();
      record.lastSyncResult = `已在打开中的会话内追加 ${appended} 轮`;
      result.live = true;
      result.turns = appended;
      result.events = appendedEvents;
    }
    return result;
  }

  const events = buildEvents(parsed, {
    ...buildOptions,
    turns: newTurns,
    append: true,
    turnStart: storedTail.lastTurn + 1,
    seqStart: storedTail.nextSeq,
    timeFloor: storedTail.lastTime,
  });
  if (!events.length) {
    record.sourceMtime = stat.mtimeMs;
    result.skipped = 'empty';
    return result;
  }
  let writer;
  try {
    writer = await ctx.sessionPersistence.open(record.sessionId, 'write');
  } catch {
    result.skipped = 'session-busy';
    record.lastSyncAt = Date.now();
    record.lastSyncResult = '等待：会话正在使用，稍后自动同步';
    return result;
  }
  try {
    for (let index = 0; index < events.length; index += APPEND_CHUNK) {
      await writer.append(events.slice(index, index + APPEND_CHUNK));
    }
    await writer.flush();
  } finally {
    await writer.close();
  }
  try {
    const probe = await ctx.sessionPersistence.open(record.sessionId, 'read');
    try {
      await probe.read(0, 1);
    } finally {
      await probe.close();
    }
  } catch (error) {
    result.error = `同步后格式校验失败：${error?.message || error}`;
    return result;
  }
  record.syncedTurns = completed.length;
  record.sourceMtime = stat.mtimeMs;
  record.turns = (record.turns || 0) + newTurns.length;
  record.events = (record.events || 0) + events.length;
  record.lastTime = events[events.length - 1].time;
  record.lastSyncAt = Date.now();
  record.lastSyncResult = `新增 ${newTurns.length} 轮`;
  result.turns = newTurns.length;
  result.events = events.length;
  return result;
}

function safeService(ctx, name) {
  try {
    return ctx.get(name);
  } catch {
    return undefined;
  }
}

function liveTurnState(session) {
  const events = session.snapshotEvents();
  let closedTurn = 0;
  let open = false;
  let lastTime = 0;
  for (const event of events) {
    if (event.type === 'turn/start') open = true;
    else if (event.type === 'turn/end') {
      open = false;
      if (typeof event.data?.turn === 'number' && event.data.turn > closedTurn) closedTurn = event.data.turn;
    }
    if (typeof event.time === 'number' && event.time > lastTime) lastTime = event.time;
  }
  return { open, closedTurn, lastTime, seq: session.seq };
}

async function readSessionTail(ctx, sessionId) {
  let handle;
  try {
    handle = await ctx.sessionPersistence.open(sessionId, 'read');
    const read = await handle.read(0, 400000);
    const events = read.events || [];
    let lastTurn = 0;
    for (const event of events) {
      const turn = event?.data?.turn;
      if (typeof turn === 'number' && turn > lastTurn) lastTurn = turn;
    }
    const last = events[events.length - 1];
    const closedTurns = events.filter((event) => event.type === 'turn/end').length;
    return { lastTurn, nextSeq: events.length, lastTime: last?.time ?? 0, closedTurns };
  } catch (error) {
    return { error: String(error?.message || error) };
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function verify(ctx, body, res) {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) throw bad('缺少 sessionId');
  const snapshot = await ctx.sessionPersistence.stat(sessionId);
  const workspaces = ctx.workspaceRegistry
    .list()
    .map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      listed: workspace.sessionIds.includes(sessionId),
    }))
    .filter((workspace) => workspace.listed);
  let apiListed = null;
  const controller = ctx.get('sessionController');
  if (controller && typeof controller.list === 'function') {
    try {
      const value = await controller.list({}, new AbortController().signal);
      apiListed = Array.isArray(value?.items) ? value.items.some((item) => item.sessionId === sessionId) : null;
    } catch (error) {
      apiListed = `error: ${error?.message || error}`;
    }
  }
  const detail = await readSessionDetail(ctx, sessionId);
  sendJson(res, 200, {
    ok: true,
    stored: Boolean(snapshot),
    header: snapshot?.header ?? null,
    eventCount: snapshot?.eventCount ?? null,
    workspaces,
    apiListed,
    detail,
  });
}

async function readSessionDetail(ctx, sessionId) {
  const persistence = ctx.sessionPersistence;
  let handle;
  try {
    handle = await persistence.open(sessionId, 'read');
    const read = await handle.read(0, 200000);
    const events = read.events || [];
    const types = {};
    for (const event of events) types[event.type] = (types[event.type] || 0) + 1;
    const titleEvent = events.filter((event) => event.type === 'session/title').pop();
    const firstUser = events.find((event) => event.type === 'user/message');
    const lastEvent = events[events.length - 1];
    return {
      events: events.length,
      types,
      title: titleEvent?.data?.title ?? null,
      firstUserText: firstUser ? contentText(firstUser.data?.content).slice(0, 120) : null,
      lastEventType: lastEvent?.type ?? null,
      firstEventTime: events[0]?.time ?? null,
      lastEventTime: lastEvent?.time ?? null,
    };
  } catch (error) {
    return { error: String(error?.message || error) };
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function escapeSessionDirectory(cwd) {
  let out = '';
  for (const ch of String(cwd || '/')) {
    if (ch === '/') out += '-';
    else if (/[A-Za-z0-9-]/.test(ch)) out += ch;
    else out += `~${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return `-${out}--`;
}

async function removeStoredSession(cwd, sessionId) {
  const dir = path.join(os.homedir(), '.dsh', 'sessions', escapeSessionDirectory(cwd || '/'), sessionId);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    /* best effort cleanup */
  }
}

async function attachWorkspace(ctx, cwd, sessionId) {
  const registry = ctx.workspaceRegistry;
  if (!registry || !cwd) return null;
  let dir = cwd;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const workspace = await registry.resolveByPath(dir);
      if (workspace) {
        await workspace.attachSession(sessionId);
        return describeWorkspaceEntity(workspace);
      }
      break;
    } catch {
      /* missing path: climb */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  let createDir = cwd;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const stat = await fsp.stat(createDir);
      if (stat.isDirectory()) break;
    } catch {
      /* climb */
    }
    const parent = path.dirname(createDir);
    if (parent === createDir) return null;
    createDir = parent;
  }
  try {
    const workspace = await registry.create(createDir, path.basename(createDir) || createDir);
    await workspace.attachSession(sessionId);
    return describeWorkspaceEntity(workspace);
  } catch {
    return null;
  }
}

async function describeWorkspace(ctx, cwd) {
  if (!cwd) return null;
  try {
    const registry = ctx.workspaceRegistry;
    let dir = cwd;
    for (let depth = 0; depth < 8; depth += 1) {
      const workspace = await registry.resolveByPath(dir);
      if (workspace) return describeWorkspaceEntity(workspace);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function describeWorkspaceEntity(workspace) {
  if (!workspace) return null;
  return { id: workspace.id, title: workspace.title, path: workspace.path };
}

async function loadThread(env, threadId) {
  const rollout = await locateRollout(env.codexHome, threadId);
  if (!rollout) {
    throw httpError(404, '没有找到这段对话的记录文件，请确认链接或该对话仍保留在本地');
  }
  const text = await readRolloutText(rollout.file);
  const parsed = parseRollout(text);
  parsed.meta.threadId = parsed.meta.threadId || threadId;
  const title = await readThreadTitle(env.codexHome, threadId);
  parsed.title = title || fallbackTitle(parsed) || `Codex 对话 ${threadId.slice(0, 8)}`;
  return { parsed, title: parsed.title, rollout };
}

function describeThread(loaded) {
  const { parsed, rollout, title } = loaded;
  return {
    threadId: parsed.meta.threadId,
    title,
    cwd: parsed.meta.cwd,
    model: parsed.meta.model,
    cliVersion: parsed.meta.cliVersion,
    createdAt: parsed.meta.createdAt,
    rolloutFile: path.basename(rollout.file),
    stats: parsed.stats,
  };
}

async function readThreadTitle(codexHome, threadId) {
  try {
    const text = await fsp.readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8');
    let title = null;
    for (const line of text.split('\n')) {
      if (!line.includes(threadId)) continue;
      try {
        const record = JSON.parse(line);
        if (record && record.id === threadId && typeof record.thread_name === 'string' && record.thread_name.trim()) {
          title = record.thread_name.trim();
        }
      } catch {
        /* skip broken line */
      }
    }
    return title;
  } catch {
    return null;
  }
}

function fallbackTitle(parsed) {
  for (const turn of parsed.turns) {
    for (const prompt of turn.prompts) {
      const firstLine = prompt.text.split('\n').find((line) => line.trim());
      if (!firstLine) continue;
      const clean = firstLine.replace(/^#+\s*/, '').trim();
      if (clean) return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean;
    }
  }
  return null;
}

/* ----------------------------------------------------------------- errors --- */

function bad(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Diagnostics only: lets a local script exercise the parser without activating the plugin. */
export const __testing = {
  parseThreadRef,
  parseRollout,
  buildEvents,
  locateRollout,
  readRolloutText,
  loadThread,
  readThreadTitle,
  ROUTE_PREFIX,
};
