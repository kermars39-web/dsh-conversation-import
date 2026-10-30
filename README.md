# Conversation Import (DeepSeek Harness plugin)

Import a local Codex conversation thread into a native DeepSeek Harness Session, filed under the
thread's own working directory, so you can continue it inside Harness — with tool calls, titles and
timestamps reconstructed — and keep it updated with an optional auto-sync.

入口：左侧栏 **更多 → 导入**（不占用外层导航行）。

## What it does

- Resolves a conversation deep link (`codex://threads/<id>` or a bare thread id) against the local
  Codex rollout store and rebuilds it as a Harness Session.
- Rebuilds turns, steps, tool calls and results as native Harness session events: `bash`, `write`,
  `edit`, `web_search`, `web_fetch`, with real timestamps and the original title.
- Files the Session under the original `cwd` (existing Harness workspace, or creates one), so it
  shows up in the sidebar where that project lives.
- Shows the most recent conversations grouped by their original working directory, with a flat
  list view as an alternative.
- Optionally keeps the imported Session in sync: every 60 seconds new **completed** turns from the
  source thread are appended, with a divergence guard that stops syncing once you continue the
  conversation locally.

## Requirements

- DeepSeek Harness desktop `0.2.1-rc.5` or later (`<0.3.0`).
- Local Codex data under `~/.codex` (the thread you want to import must exist on this machine).
- macOS / Linux. Compressed rollouts use Node's zstd support with a `zstd` CLI fallback.

## Install

Plugin market: pending review. Until then, install from source:

```text
plugin_manager install_bundle  target=<absolute path to this repository>
```

or via the Plugin Manager UI: **插件 → 添加插件 → 本地目录**.

Restart or reload the page after installing; the entry appears under the sidebar's **More** menu.

## Use

1. Sidebar → **More → 导入**.
2. Paste a deep link, or pick a row from **Recent conversations** (grouped by folder).
3. **Read conversation** checks the title, original directory, target workspace and size.
4. **Import locally**, then **Open conversation**.
5. Optional: in the **Sync** card, keep the per-conversation switch on to receive new turns, or turn
   it off before you continue the conversation here.

## How it works

1. `index.js` (Host half) locates the newest rollout file for the thread id, decompresses it when
   needed and parses `session_meta`, `task_started` / `task_complete`, `item_completed` and
   `response_item` records.
2. Turns with no user prompt (ambient UI state or self-triggered) are folded into the previous turn;
   only finished turns are imported so the tail can be synced once it completes.
3. Codex tool items are mapped to Harness tools (`CommandExecution` → `bash`, `FileChange(add)` →
   `write`, `FileChange(update)` → `edit`, `web.search` → `web_search` / `web_fetch`). MCP calls,
   sub-agent traffic, images and encrypted reasoning are skipped.
4. The Host half writes a native session log through `ctx.sessionPersistence` (append-only, chunked),
   reads it back to verify the format, then attaches the Session to the workspace for the original
   directory.
5. `client.js` (Client half) registers the panel behind the sidebar's **More** menu and renders the
   import page with theme tokens only.

## Sync semantics

- Polls every 60 seconds; a source file whose mtime did not change is not parsed again.
- Only **completed** turns are appended, using a `syncedTurns` watermark; event sequence and time
  continue from the existing log.
- Skipped while the Session is in use (another writer owns it); retried on the next tick.
- **Divergence guard**: if the Session already contains turns beyond the last sync (you continued it
  locally), auto-sync pauses for that conversation and the UI says so. Re-enabling the per-conversation
  switch is an explicit override.
- Single-direction only: the source thread is never modified.

## Privacy

- Reads only `~/.codex` rollout metadata/content for the thread you ask for.
- Writes only Harness Sessions and plugin state (`~/.dsh/codex-importer/imports.json`).
- The panel talks to its Host half over a same-origin HTTP endpoint; nothing is uploaded anywhere.
- The optional “hide external tool names” switch rewrites visible message text only; tool arguments
  and outputs keep the original content.

## Known limitations

- Import is a snapshot; the last (still generating) turn is imported by a later sync.
- Images and file attachments in the source thread are not imported.
- Threads split across several rollout files use the newest segment; multi-segment merging is planned.
- An already-open Session does not stream appended turns; reopen it or refresh the list to see them.
- Windows is untested.

## 中文说明

把本机的 Codex 对话按原始工作目录导入为 DeepSeek Harness 会话：左侧栏「更多 → 导入」，粘贴对话
深度链接或从「最近的对话」中点选；导入后可在 Harness 里继续对话、查看工具调用与完整上下文，并可
开启自动同步（每 60 秒检查一次源对话，只追加已完成的轮次；在本地继续聊过的会话会自动暂停同步）。

导入是快照；源对话不会回写；图片与多段 rollout 尚未支持；打开中的会话需重新打开才能看到追加内容。
数据只在本机读写（`~/.codex` → Harness 会话），不上传任何内容。

## License

MIT
