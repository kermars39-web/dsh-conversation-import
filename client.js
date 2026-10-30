/**
 * Client half of the Codex conversation importer: a sidebar panel icon and the
 * import page it opens. The page talks to the Host half over a same-origin JSON
 * endpoint and opens the imported Session through the Client services.
 */
window.__ModuleLoader__.load({
  id: 'dsh-conversation-import',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'codex-importer';
    const ROUTE = '/codex-importer';

    const DICT = {
      zh: {
        'panel.title': '导入',
        'panel.subtitle': '粘贴对话的深度链接，原对话会按它自己的工作目录导入为本地会话，之后可以在这里继续。',
        'input.label': '对话深度链接',
        'input.placeholder': '在此粘贴对话深度链接',
        'action.back': '返回',
        'action.preview': '读取对话',
        'action.previewing': '正在读取…',
        'action.import': '导入到本地',
        'action.importing': '正在写入会话…',
        'action.open': '打开对话',
        'action.again': '再导入一份',
        'action.reset': '导入另一个',
        'hint.paste': '支持深度链接，也可以直接粘贴线程 ID。',
        'error.empty': '请先粘贴对话链接。',
        'recent.heading': '最近的对话',
        'recent.imported': '已导入',
        'recent.hint': '点一行直接读取，或在上方粘贴任意链接。',
        'recent.viewFolder': '文件夹',
        'recent.viewList': '列表',
        'recent.unknownFolder': '未记录工作目录',
        'selected.prefix': '已选对话',
        'selected.clear': '换一个',
        'sync.heading': '同步',
        'sync.auto': '自动同步已导入的对话',
        'sync.autoHint': '每分钟检查一次原对话，新增轮次会追加到已导入会话；会话正在使用时顺延到下一轮。',
        'sync.now': '立即同步',
        'sync.busy': '同步中…',
        'sync.done': '已同步：新增 {count} 轮',
        'sync.upToDate': '已是最新',
        'sync.busySession': '原会话正在使用，稍后自动重试',
        'sync.failed': '同步失败：{message}',
        'sync.perConversation': '每段对话的自动同步',
        'sync.never': '尚未同步',
        'sync.diverged': '本地已续聊 · 自动同步暂停',
        'preview.heading': '已找到这段对话',
        'preview.title': '标题',
        'preview.cwd': '原工作目录',
        'preview.target': '导入位置',
        'preview.newWorkspace': '将新建项目',
        'preview.scale': '对话规模',
        'preview.scaleValue': '{turns} 轮 · {prompts} 条消息 · {tools} 次工具调用',
        'preview.createdAt': '对话时间',
        'preview.already': '这段对话之前导入过，可以直接打开已有会话。',
        'options.tools': '保留工具调用记录',
        'options.rebrand': '隐藏正文里的外部工具名',
        'options.turns': '只导入最近',
        'options.turnsUnit': '轮',
        'options.turnsHint': '留空表示全部',
        'progress.importing': '正在把对话写入本地会话，稍等…',
        'result.heading': '导入完成',
        'result.title': '会话',
        'result.id': '会话 ID',
        'result.target': '所在项目',
        'result.events': '写入记录',
        'result.note': '已按原目录归入左侧项目，点“打开对话”继续。',
        'result.noteUngrouped': '原目录已不存在，会话未归入项目，可从最近列表打开。',
        'result.pending': '最后一轮还在生成，完成后会自动同步补上。',
        'result.sync': '自动同步已开启，原对话后续新增的轮次会自动追加。',
        'foot.onlyLocal': '链接只在本机解析，不上传任何内容。',
        'unit.events': '{count} 条',
        'unit.turns': '{count} 轮',
      },
      en: {
        'panel.title': 'Import',
        'panel.subtitle': 'Paste a conversation deep link. It is imported as a local Session under its own working directory and can continue here.',
        'input.label': 'Conversation deep link',
        'input.placeholder': 'Paste a conversation deep link',
        'action.back': 'Back',
        'action.preview': 'Read conversation',
        'action.previewing': 'Reading…',
        'action.import': 'Import locally',
        'action.importing': 'Writing Session…',
        'action.open': 'Open conversation',
        'action.again': 'Import another copy',
        'action.reset': 'Import another',
        'hint.paste': 'Accepts a deep link or a bare thread id.',
        'error.empty': 'Paste a conversation link first.',
        'recent.heading': 'Recent conversations',
        'recent.imported': 'imported',
        'recent.hint': 'Pick a row, or paste any link above.',
        'recent.viewFolder': 'Folders',
        'recent.viewList': 'List',
        'recent.unknownFolder': 'No recorded directory',
        'selected.prefix': 'Selected',
        'selected.clear': 'Change',
        'sync.heading': 'Sync',
        'sync.auto': 'Auto-sync imported conversations',
        'sync.autoHint': 'Checks the source conversation every minute and appends new turns; skipped while the Session is in use.',
        'sync.now': 'Sync now',
        'sync.busy': 'Syncing…',
        'sync.done': 'Synced: {count} new turns',
        'sync.upToDate': 'Already up to date',
        'sync.busySession': 'Session in use; will retry automatically',
        'sync.failed': 'Sync failed: {message}',
        'sync.perConversation': 'Auto-sync per conversation',
        'sync.never': 'not synced yet',
        'sync.diverged': 'continued locally · auto-sync paused',
        'preview.heading': 'Conversation found',
        'preview.title': 'Title',
        'preview.cwd': 'Original directory',
        'preview.target': 'Imported into',
        'preview.newWorkspace': 'new project',
        'preview.scale': 'Size',
        'preview.scaleValue': '{turns} turns · {prompts} messages · {tools} tool calls',
        'preview.createdAt': 'Conversation time',
        'preview.already': 'This conversation was imported before; open the existing Session.',
        'options.tools': 'Keep tool-call records',
        'options.rebrand': 'Hide external tool names in text',
        'options.turns': 'Only the latest',
        'options.turnsUnit': 'turns',
        'options.turnsHint': 'Empty means everything',
        'progress.importing': 'Writing the conversation into a local Session…',
        'result.heading': 'Import finished',
        'result.title': 'Session',
        'result.id': 'Session ID',
        'result.target': 'Project',
        'result.events': 'Records',
        'result.note': 'Filed under the original directory; press "Open conversation" to continue.',
        'result.noteUngrouped': 'The original directory is gone, so the Session is ungrouped.',
        'result.pending': 'The last turn is still generating; auto-sync will append it once finished.',
        'result.sync': 'Auto-sync is on; new turns from the source conversation are appended automatically.',
        'foot.onlyLocal': 'The link is resolved on this machine only; nothing is uploaded.',
        'unit.events': '{count} records',
        'unit.turns': '{count} turns',
      },
    };

    const CSS = `
.dci-root { position: relative; height: 100%; min-height: 0; box-sizing: border-box; overflow-y: auto; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.dci-page { max-width: 780px; margin: 0 auto; padding: 40px 32px 72px; font-size: 13px; line-height: 1.65; }
.dci-title { margin: 0 0 8px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
.dci-subtitle { margin: 0 0 26px; color: var(--dsw-alias-label-secondary); max-width: 620px; }
.dci-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 18px 20px; margin-bottom: 16px; }
.dci-label { display: block; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin-bottom: 8px; }
.dci-input { width: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-primary); padding: 11px 13px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; outline: none; transition: border-color 0.15s ease; }
.dci-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dci-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.7; }
.dci-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dci-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.dci-btn { appearance: none; border-radius: 9px; padding: 8px 15px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: opacity 0.15s ease; }
.dci-btn:disabled { opacity: 0.5; cursor: default; }
.dci-btn-primary { background: var(--dsw-alias-brand-primary); color: #ffffff; }
.dci-btn-secondary { background: transparent; color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dci-spacer { flex: 1; }
.dci-error { margin-top: 14px; color: var(--dsw-alias-state-error-primary); font-size: 12.5px; }
.dci-section-title { margin: 0 0 12px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.dci-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.dci-grid { display: grid; grid-template-columns: 104px 1fr; gap: 8px 16px; }
.dci-key { color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dci-val { font-size: 12.5px; word-break: break-word; }
.dci-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dci-badge { display: inline-block; margin-top: 14px; padding: 6px 10px; border-radius: 8px; font-size: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dci-badge-ok { color: var(--dsw-alias-state-success-primary); }
.dci-options { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dci-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; cursor: pointer; }
.dci-num { width: 60px; box-sizing: border-box; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; padding: 4px 8px; color: inherit; font-size: 12.5px; outline: none; }
.dci-progress { margin-top: 12px; display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dci-spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); animation: dci-spin 0.8s linear infinite; }
@keyframes dci-spin { to { transform: rotate(360deg); } }
.dci-foot { margin-top: 22px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.dci-head { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; }
.dci-back { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); border-radius: 8px; padding: 5px 11px 5px 8px; font-size: 12.5px; cursor: pointer; transition: color 0.15s ease, background 0.15s ease; }
.dci-back:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.dci-folders { display: flex; flex-direction: column; gap: 2px; margin: -2px -8px -4px; }
.dci-folder-head { display: flex; align-items: center; gap: 7px; width: 100%; background: transparent; border: none; border-radius: 8px; padding: 6px 8px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dci-folder-head:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dci-chevron { transition: transform 0.15s ease; flex: none; }
.dci-folder-name { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dci-folder-path { color: var(--dsw-alias-label-secondary); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.dci-folder-count { color: var(--dsw-alias-label-secondary); font-size: 11.5px; flex: none; }
.dci-folder-body { display: flex; flex-direction: column; gap: 1px; padding-left: 18px; }
.dci-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.dci-card-head .dci-section-title { margin-bottom: 0; }
.dci-seg { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); flex: none; }
.dci-seg-btn { appearance: none; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; padding: 4px 11px; border-radius: 6px; cursor: pointer; }
.dci-seg-btn:hover { color: var(--dsw-alias-label-primary); }
.dci-seg-active { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.dci-sync-list { display: flex; flex-direction: column; gap: 2px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dci-sync-item { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 12.5px; }
.dci-sync-item-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dci-sync-item-meta { color: var(--dsw-alias-label-secondary); font-size: 11.5px; flex: none; }
.dci-recent-row-nested { padding-left: 8px; }
.dci-sync-row { display: flex; align-items: center; gap: 12px; }
.dci-sync-row .dci-btn { margin-left: auto; }
.dci-selected { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; padding: 6px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 12.5px; }
.dci-selected-label { color: var(--dsw-alias-label-secondary); flex: none; }
.dci-selected-title { color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.dci-link-btn { appearance: none; background: transparent; border: none; color: var(--dsw-alias-label-secondary); font-size: 12px; cursor: pointer; padding: 0 2px; flex: none; }
.dci-link-btn:hover { color: var(--dsw-alias-label-primary); }
.dci-recent { display: flex; flex-direction: column; gap: 2px; margin: -4px -8px -6px; }
.dci-recent-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: transparent; border: none; border-radius: 8px; padding: 8px 8px; cursor: pointer; color: inherit; font-size: 12.5px; }
.dci-recent-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dci-recent-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dci-recent-time { color: var(--dsw-alias-label-secondary); font-size: 11.5px; flex: none; }
.dci-recent-tag { flex: none; font-size: 11px; padding: 1px 6px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-success-primary); }

`;

    function PanelIcon(props) {
      const size = (props && props.size) || 20;
      const active = Boolean(props && props.active);
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            opacity: active ? 1 : 0.86,
          },
        },
        h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            style: { display: 'block', pointerEvents: 'none' },
          },
          [
            h('path', { key: 'a', d: 'M12 3.5v8.8' }),
            h('path', { key: 'b', d: 'M8.8 9.3 12 12.5l3.2-3.2' }),
            h('path', { key: 'c', d: 'M4.5 13.4v3.4A2.7 2.7 0 0 0 7.2 19.5h9.6a2.7 2.7 0 0 0 2.7-2.7v-3.4' }),
          ],
        ),
      );
    }

    async function callHost(route, payload) {
      const response = await fetch(`${ROUTE}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok || !data || data.ok !== true) {
        const message = data && data.error && data.error.message ? data.error.message : `HTTP ${response.status}`;
        throw new Error(message);
      }
      return data;
    }

    function intlLocaleOf(ctx) {
      try {
        const active = ctx.locale.getLocale().active;
        if (!active) return undefined;
        if (active === 'zh') return 'zh-CN';
        if (active === 'en') return 'en-US';
        return active;
      } catch {
        return undefined;
      }
    }

    function formatDate(timestamp, localeTag) {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '—';
      try {
        return new Intl.DateTimeFormat(localeTag, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(timestamp));
      } catch {
        return new Date(timestamp).toLocaleString();
      }
    }

    function formatRelative(timestamp, localeTag) {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '';
      const diff = Date.now() - timestamp;
      const units = [
        ['year', 365 * 24 * 3600 * 1000],
        ['month', 30 * 24 * 3600 * 1000],
        ['day', 24 * 3600 * 1000],
        ['hour', 3600 * 1000],
        ['minute', 60 * 1000],
      ];
      try {
        const rtf = new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' });
        for (const [unit, size] of units) {
          const value = Math.round(diff / size);
          if (Math.abs(value) >= 1 || unit === 'minute') return rtf.format(-value, unit);
        }
      } catch {
        /* fall through */
      }
      return '';
    }

    function scrubTitle(value) {
      return String(value || '').replace(/codex/gi, '本地助手');
    }

    function folderName(cwd) {
      if (!cwd) return '';
      const parts = String(cwd).split('/').filter(Boolean);
      return parts.length ? parts[parts.length - 1] : String(cwd);
    }

    function folderHint(cwd) {
      if (!cwd) return '';
      const parts = String(cwd).split('/').filter(Boolean);
      if (parts.length <= 2) return String(cwd);
      return `…/${parts.slice(-2).join('/')}`;
    }

    function groupThreads(rows) {
      const groups = new Map();
      for (const row of rows || []) {
        const key = row.cwd || '';
        let group = groups.get(key);
        if (!group) {
          group = { cwd: key, rows: [], latest: 0 };
          groups.set(key, group);
        }
        group.rows.push(row);
        group.latest = Math.max(group.latest, row.updatedAt || 0);
      }
      return Array.from(groups.values()).sort((a, b) => b.latest - a.latest);
    }

    const CHEVRON_PATH = 'M6 9l6 6 6-6';
    const FOLDER_PATH = 'M3 7.2A2.2 2.2 0 0 1 5.2 5h3.2l1.9 1.9h8.5A2.2 2.2 0 0 1 21 9.1v8.7A2.2 2.2 0 0 1 18.8 20H5.2A2.2 2.2 0 0 1 3 17.8z';

    const MORE_CSS = `
.dci-more { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 34px; box-sizing: border-box; padding: 6px 8px; border: none; border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; cursor: pointer; text-align: left; }
.dci-more:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dci-more-glyph { display: inline-flex; flex: none; width: 14px; height: 14px; align-items: center; justify-content: center; color: var(--dsw-alias-menu-icon); }
.dci-more-glyph svg { width: 14px; height: 14px; }
.dci-more-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

    function makeMoreRow(ctx, t) {
      return function ImportMoreRow(props) {
        const open = () => {
          // The panel is intentionally not a sidebar panel entry, so the owner's
          // onOpen() may skip it; selectPanel checks the live main registry.
          try {
            if (props && typeof props.onOpen === 'function') props.onOpen('codex-importer');
          } catch {
            /* owner callback is optional */
          }
          try {
            ctx.layout.selectPanel('codex-importer');
          } catch {
            /* navigation is best effort */
          }
          try {
            if (props && typeof props.onDismiss === 'function') props.onDismiss();
          } catch {
            /* menu dismissal is best effort */
          }
        };
        return h(
          React.Fragment,
          null,
          h('style', { key: 'style' }, MORE_CSS),
          h(
            'button',
            { type: 'button', className: 'dci-more', onClick: open, title: t('panel.title') },
            h(
              'span',
              { className: 'dci-more-glyph' },
              h(
                'svg',
                {
                  viewBox: '0 0 24 24',
                  width: 14,
                  height: 14,
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.7,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  'aria-hidden': true,
                },
                [
                  h('path', { key: 'a', d: 'M12 3.5v8.8' }),
                  h('path', { key: 'b', d: 'M8.8 9.3 12 12.5l3.2-3.2' }),
                  h('path', { key: 'c', d: 'M4.5 13.4v3.4A2.7 2.7 0 0 0 7.2 19.5h9.6a2.7 2.7 0 0 0 2.7-2.7v-3.4' }),
                ],
              ),
            ),
            h('span', { className: 'dci-more-label' }, t('panel.title')),
          ),
        );
      };
    }

    function makePanel(ctx, t) {
      return function ImportPanel() {
        const localeTag = intlLocaleOf(ctx);
        const [link, setLink] = React.useState('');
        const [preview, setPreview] = React.useState(null);
        const [result, setResult] = React.useState(null);
        const [error, setError] = React.useState('');
        const [phase, setPhase] = React.useState('idle');
        const [includeTools, setIncludeTools] = React.useState(true);
        const [rebrand, setRebrand] = React.useState(true);
        const [maxTurns, setMaxTurns] = React.useState('');
        const [recent, setRecent] = React.useState(null);
        const [selected, setSelected] = React.useState(null);
        const [viewMode, setViewMode] = React.useState('folder');
        const [collapsed, setCollapsed] = React.useState({});
        const [autoSync, setAutoSync] = React.useState(true);
        const [syncing, setSyncing] = React.useState(false);
        const [syncMessage, setSyncMessage] = React.useState('');
        const [hasImports, setHasImports] = React.useState(false);
        const [imports, setImports] = React.useState({});

        const busy = phase === 'preview' || phase === 'import';

        async function loadRecent() {
          try {
            const data = await callHost('recent', {});
            setRecent(Array.isArray(data.threads) ? data.threads : []);
            if ((data.threads || []).some((row) => row.alreadyImported)) setHasImports(true);
          } catch {
            setRecent([]);
          }
        }

        async function loadSettings() {
          try {
            const data = await callHost('settings', {});
            setAutoSync(Boolean(data.settings && data.settings.autoSync !== false));
            if (data.settings && data.settings.imports) {
              setImports(data.settings.imports);
              if (Object.keys(data.settings.imports).length) setHasImports(true);
            }
          } catch {
            /* keep defaults */
          }
        }

        async function runSync(force) {
          setSyncing(true);
          try {
            const data = await callHost('sync', { force: Boolean(force) });
            const info = data.sync || {};
            setAutoSync(info.autoSync !== false);
            if (info.imports && Object.keys(info.imports).length) {
              setHasImports(true);
              setImports(info.imports);
            }
            const appended = info.appendedTurns || 0;
            const blocked = (info.results || []).some((item) => item.skipped === 'session-busy');
            const failed = (info.results || []).find((item) => item.error);
            if (failed) setSyncMessage(t('sync.failed').replace('{message}', failed.error));
            else if (appended) setSyncMessage(t('sync.done').replace('{count}', String(appended)));
            else if (blocked) setSyncMessage(t('sync.busySession'));
            else setSyncMessage(force ? t('sync.upToDate') : '');
            if (appended) {
              try {
                await ctx.sessions.refresh();
              } catch {
                /* best effort */
              }
            }
          } catch (failure) {
            setSyncMessage(t('sync.failed').replace('{message}', failure.message || String(failure)));
          } finally {
            setSyncing(false);
          }
        }

        async function toggleConversationSync(threadId, next) {
          setImports((prev) => Object.assign({}, prev, { [threadId]: Object.assign({}, prev[threadId], { sync: next }) }));
          try {
            const data = await callHost('settings', { threadId, sync: next });
            if (data.settings && data.settings.imports) setImports(data.settings.imports);
          } catch {
            /* keep the local value */
          }
        }

        async function toggleAutoSync(next) {
          setAutoSync(next);
          try {
            await callHost('settings', { autoSync: next });
          } catch {
            /* keep the local value */
          }
        }

        React.useEffect(() => {
          let alive = true;
          (async () => {
            await loadSettings();
            await loadRecent();
            if (alive) await runSync(false);
          })();
          return () => {
            alive = false;
          };
        }, []);

        async function reveal(sessionId) {
          try {
            await ctx.sessions.refresh();
          } catch {
            /* list refresh is best effort */
          }
          try {
            ctx.uiWorkspace.openSession(sessionId);
          } catch {
            try {
              ctx.layout.selectPanel('conversation');
            } catch {
              /* nothing else to do */
            }
          }
        }

        async function onPreview(event, explicit) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          const value = (typeof explicit === 'string' ? explicit : link || (selected && selected.deepLink) || '').trim();
          if (!value) {
            setError(t('error.empty'));
            return;
          }
          setError('');
          setPhase('preview');
          setResult(null);
          try {
            const data = await callHost('preview', { link: value });
            setPreview(data);
          } catch (failure) {
            setPreview(null);
            setError(failure.message || String(failure));
          } finally {
            setPhase('idle');
          }
        }

        async function runImport(force) {
          const value = (link.trim() || (selected && selected.deepLink) || '').trim();
          if (!value) {
            setError(t('error.empty'));
            return;
          }
          setError('');
          setPhase('import');
          try {
            const turns = Number(maxTurns);
            const data = await callHost('import', {
              link: value,
              force: Boolean(force),
              includeToolCalls: includeTools,
              rebrandText: rebrand,
              maxTurns: Number.isFinite(turns) && turns > 0 ? Math.floor(turns) : 0,
            });
            setResult(data.session);
            setHasImports(true);
            setSyncMessage('');
            try {
              await ctx.sessions.refresh();
            } catch {
              /* best effort */
            }
            void loadRecent();
          } catch (failure) {
            setError(failure.message || String(failure));
          } finally {
            setPhase('idle');
          }
        }

        function reset() {
          setPreview(null);
          setResult(null);
          setError('');
          setLink('');
          setSelected(null);
          setMaxTurns('');
        }

        function renderThreadRow(row) {
          return h(
            'button',
            {
              key: row.threadId,
              type: 'button',
              className: 'dci-recent-row dci-recent-row-nested',
              disabled: busy,
              onClick: () => {
                setSelected(row);
                setLink('');
                setResult(null);
                onPreview(null, row.deepLink);
              },
            },
            h('span', { className: 'dci-recent-title' }, scrubTitle(row.title)),
            row.alreadyImported ? h('span', { className: 'dci-recent-tag' }, t('recent.imported')) : null,
            h('span', { className: 'dci-recent-time' }, formatRelative(row.updatedAt, localeTag)),
          );
        }

        const groups = groupThreads(recent || []);

        const recentNode = groups.length
          ? h(
              'div',
              { className: 'dci-card', key: 'recent' },
              h(
                'div',
                { className: 'dci-card-head' },
                h('h2', { className: 'dci-section-title' }, t('recent.heading')),
                h(
                  'div',
                  { className: 'dci-seg', role: 'group' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: viewMode === 'folder' ? 'dci-seg-btn dci-seg-active' : 'dci-seg-btn',
                      onClick: () => setViewMode('folder'),
                    },
                    t('recent.viewFolder'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: viewMode === 'list' ? 'dci-seg-btn dci-seg-active' : 'dci-seg-btn',
                      onClick: () => setViewMode('list'),
                    },
                    t('recent.viewList'),
                  ),
                ),
              ),
              viewMode === 'list'
                ? h('div', { className: 'dci-recent' }, (recent || []).map(renderThreadRow))
                : h(
                'div',
                { className: 'dci-folders' },
                groups.map((group) => {
                  const key = group.cwd || '__none__';
                  const isCollapsed = Boolean(collapsed[key]);
                  return h(
                    'div',
                    { key },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dci-folder-head',
                        onClick: () => setCollapsed((prev) => Object.assign({}, prev, { [key]: !prev[key] })),
                      },
                      h(
                        'svg',
                        {
                          className: 'dci-chevron',
                          viewBox: '0 0 24 24',
                          width: 12,
                          height: 12,
                          fill: 'none',
                          stroke: 'currentColor',
                          strokeWidth: 2,
                          strokeLinecap: 'round',
                          strokeLinejoin: 'round',
                          style: { transform: isCollapsed ? 'rotate(-90deg)' : 'none' },
                        },
                        h('path', { d: CHEVRON_PATH }),
                      ),
                      h(
                        'svg',
                        {
                          viewBox: '0 0 24 24',
                          width: 13,
                          height: 13,
                          fill: 'none',
                          stroke: 'currentColor',
                          strokeWidth: 1.6,
                          strokeLinejoin: 'round',
                        },
                        h('path', { d: FOLDER_PATH }),
                      ),
                      h(
                        'span',
                        { className: 'dci-folder-name' },
                        group.cwd ? folderName(group.cwd) : t('recent.unknownFolder'),
                      ),
                      h('span', { className: 'dci-folder-path', title: group.cwd }, folderHint(group.cwd)),
                      h('span', { className: 'dci-folder-count' }, String(group.rows.length)),
                    ),
                    isCollapsed ? null : h('div', { className: 'dci-folder-body' }, group.rows.map(renderThreadRow)),
                  );
                }),
                  ),
              h('p', { className: 'dci-hint', style: { marginTop: '10px' } }, t('recent.hint')),
            )
          : null;

        const syncNode = hasImports
          ? h(
              'div',
              { className: 'dci-card', key: 'sync' },
              h('h2', { className: 'dci-section-title' }, t('sync.heading')),
              h(
                'div',
                { className: 'dci-sync-row' },
                h(
                  'label',
                  { className: 'dci-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: autoSync,
                    onChange: (event) => toggleAutoSync(event.target.checked),
                  }),
                  t('sync.auto'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dci-btn dci-btn-secondary',
                    disabled: syncing,
                    onClick: () => runSync(true),
                  },
                  syncing ? t('sync.busy') : t('sync.now'),
                ),
              ),
              h('p', { className: 'dci-hint', style: { marginTop: '8px' } }, syncMessage || t('sync.autoHint')),
              Object.keys(imports).length
                ? h(
                    'div',
                    { className: 'dci-sync-list' },
                    h('span', { className: 'dci-key', style: { marginBottom: '2px' } }, t('sync.perConversation')),
                    Object.entries(imports).map(([threadId, record]) =>
                      h(
                        'div',
                        { className: 'dci-sync-item', key: threadId },
                        h(
                          'label',
                          { className: 'dci-check', style: { flex: 1, minWidth: 0 } },
                          h('input', {
                            type: 'checkbox',
                            checked: record.sync !== false,
                            onChange: (event) => toggleConversationSync(threadId, event.target.checked),
                          }),
                          h('span', { className: 'dci-sync-item-title' }, scrubTitle(record.title)),
                        ),
                        h(
                          'span',
                          { className: 'dci-sync-item-meta' },
                          record.diverged && record.sync === false
                            ? t('sync.diverged')
                            : record.lastSyncResult || (record.lastSyncAt ? t('sync.never') : t('sync.never')),
                        ),
                      ),
                    ),
                  )
                : null,
            )
          : null;

        const previewNode = preview
          ? h(
              'div',
              { className: 'dci-card', key: 'preview' },
              h('h2', { className: 'dci-section-title' }, h('span', { className: 'dci-dot' }), t('preview.heading')),
              h(
                'div',
                { className: 'dci-grid' },
                h('span', { className: 'dci-key' }, t('preview.title')),
                h('span', { className: 'dci-val' }, scrubTitle(preview.thread.title)),
                h('span', { className: 'dci-key' }, t('preview.cwd')),
                h('span', { className: 'dci-val dci-mono' }, preview.thread.cwd),
                h('span', { className: 'dci-key' }, t('preview.target')),
                h(
                  'span',
                  { className: 'dci-val' },
                  preview.workspace
                    ? `${preview.workspace.title} · ${preview.workspace.path}`
                    : t('preview.newWorkspace'),
                ),
                h('span', { className: 'dci-key' }, t('preview.scale')),
                h(
                  'span',
                  { className: 'dci-val' },
                  t('preview.scaleValue')
                    .replace('{turns}', String(preview.thread.stats.turns))
                    .replace('{prompts}', String(preview.thread.stats.prompts))
                    .replace('{tools}', String(preview.thread.stats.toolCalls)),
                ),
                h('span', { className: 'dci-key' }, t('preview.createdAt')),
                h('span', { className: 'dci-val' }, formatDate(preview.thread.createdAt, localeTag)),
              ),
              preview.alreadyImported
                ? h('div', { className: 'dci-badge' }, t('preview.already'))
                : null,
              h(
                'div',
                { className: 'dci-options' },
                h(
                  'label',
                  { className: 'dci-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: includeTools,
                    onChange: (event) => setIncludeTools(event.target.checked),
                  }),
                  t('options.tools'),
                ),
                h(
                  'label',
                  { className: 'dci-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: rebrand,
                    onChange: (event) => setRebrand(event.target.checked),
                  }),
                  t('options.rebrand'),
                ),
                h(
                  'label',
                  { className: 'dci-check' },
                  t('options.turns'),
                  h('input', {
                    className: 'dci-num',
                    value: maxTurns,
                    inputMode: 'numeric',
                    placeholder: t('options.turnsHint'),
                    onChange: (event) => setMaxTurns(event.target.value.replace(/[^0-9]/g, '')),
                  }),
                  t('options.turnsUnit'),
                ),
              ),
              h(
                'div',
                { className: 'dci-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dci-btn dci-btn-primary',
                    disabled: busy,
                    onClick: () => runImport(false),
                  },
                  phase === 'import' ? t('action.importing') : t('action.import'),
                ),
                preview.alreadyImported
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dci-btn dci-btn-secondary',
                        disabled: busy,
                        onClick: () => reveal(preview.alreadyImported.sessionId),
                      },
                      t('action.open'),
                    )
                  : null,
                preview.alreadyImported
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dci-btn dci-btn-secondary',
                        disabled: busy,
                        onClick: () => runImport(true),
                      },
                      t('action.again'),
                    )
                  : null,
              ),
              phase === 'import'
                ? h(
                    'div',
                    { className: 'dci-progress' },
                    h('span', { className: 'dci-spin' }),
                    t('progress.importing'),
                  )
                : null,
            )
          : null;

        const resultNode = result
          ? h(
              'div',
              { className: 'dci-card', key: 'result' },
              h('h2', { className: 'dci-section-title' }, h('span', { className: 'dci-dot' }), t('result.heading')),
              h(
                'div',
                { className: 'dci-grid' },
                h('span', { className: 'dci-key' }, t('result.title')),
                h('span', { className: 'dci-val' }, scrubTitle(result.title)),
                h('span', { className: 'dci-key' }, t('result.target')),
                h(
                  'span',
                  { className: 'dci-val' },
                  result.workspace ? `${result.workspace.title} · ${result.workspace.path}` : '—',
                ),
                h('span', { className: 'dci-key' }, t('result.id')),
                h('span', { className: 'dci-val dci-mono' }, result.sessionId),
                h('span', { className: 'dci-key' }, t('result.events')),
                h('span', { className: 'dci-val' }, t('unit.events').replace('{count}', String(result.events || 0))),
                h('span', { className: 'dci-key' }, t('unit.turns')),
                h('span', { className: 'dci-val' }, t('unit.turns').replace('{count}', String(result.turns || 0))),
              ),
              h(
                'div',
                { className: 'dci-badge dci-badge-ok' },
                result.workspace ? t('result.note') : t('result.noteUngrouped'),
              ),
              result.pendingTurns
                ? h('div', { className: 'dci-badge' }, t('result.pending'))
                : null,
              h('div', { className: 'dci-badge' }, t('result.sync')),
              h(
                'div',
                { className: 'dci-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dci-btn dci-btn-primary',
                    onClick: () => reveal(result.sessionId),
                  },
                  t('action.open'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dci-btn dci-btn-secondary',
                    disabled: syncing,
                    onClick: () => runSync(true),
                  },
                  syncing ? t('sync.busy') : t('sync.now'),
                ),
                h('button', { type: 'button', className: 'dci-btn dci-btn-secondary', onClick: reset }, t('action.reset')),
              ),
            )
          : null;

        return h(
          'div',
          { className: 'dci-root' },
          h('style', { key: 'style' }, CSS),
          h(
            'div',
            { className: 'dci-page', key: 'page' },
            h(
              'div',
              { className: 'dci-head' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dci-back',
                  title: t('action.back'),
                  'aria-label': t('action.back'),
                  onClick: () => {
                    try {
                      ctx.layout.selectPanel('conversation');
                    } catch {
                      /* navigation is best effort */
                    }
                  },
                },
                h(
                  'svg',
                  {
                    viewBox: '0 0 24 24',
                    width: 14,
                    height: 14,
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 2,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    'aria-hidden': true,
                  },
                  [h('path', { key: 'p', d: 'M14.5 6 9 12l5.5 6' })],
                ),
                h('span', null, t('action.back')),
              ),
            ),
            h('h1', { className: 'dci-title' }, t('panel.title')),
            h('p', { className: 'dci-subtitle' }, t('panel.subtitle')),
            h(
              'form',
              { className: 'dci-card', onSubmit: onPreview },
              h('label', { className: 'dci-label', htmlFor: 'dci-link' }, t('input.label')),
              selected
                ? h(
                    'div',
                    { className: 'dci-selected' },
                    h('span', { className: 'dci-selected-label' }, t('selected.prefix')),
                    h('span', { className: 'dci-selected-title' }, scrubTitle(selected.title)),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dci-link-btn',
                        onClick: () => {
                          setSelected(null);
                          setPreview(null);
                        },
                      },
                      t('selected.clear'),
                    ),
                  )
                : null,
              h('input', {
                id: 'dci-link',
                className: 'dci-input',
                value: link,
                spellCheck: false,
                autoComplete: 'off',
                placeholder: t('input.placeholder'),
                onChange: (event) => {
                  const value = event.target.value;
                  setLink(value);
                  if (value) setSelected(null);
                },
              }),
              h(
                'div',
                { className: 'dci-actions' },
                h('span', { className: 'dci-hint' }, t('hint.paste')),
                h('span', { className: 'dci-spacer' }),
                h(
                  'button',
                  { type: 'submit', className: 'dci-btn dci-btn-primary', disabled: busy },
                  phase === 'preview' ? t('action.previewing') : t('action.preview'),
                ),
              ),
              error ? h('div', { className: 'dci-error' }, error) : null,
            ),
            resultNode,
            result ? null : previewNode,
            result ? null : recentNode,
            result ? null : syncNode,
            h('p', { className: 'dci-foot' }, t('foot.onlyLocal')),
          ),
        );
      };
    }


    return {
      inject: ['slots', 'locale', 'layout', 'uiWorkspace', 'sessions'],
      apply(ctx) {
        const fallback = (key) => (DICT.zh[key] !== undefined ? DICT.zh[key] : DICT.en[key] !== undefined ? DICT.en[key] : key);
        let t = fallback;
        try {
          const disposers = [];
          const offZh = ctx.locale.register(NS, 'zh', DICT.zh);
          disposers.push(offZh);
          const offEn = ctx.locale.register(NS, 'en', DICT.en);
          disposers.push(offEn);
          try {
            ctx.effect(() => () => {
              for (const dispose of disposers) {
                try {
                  dispose();
                } catch {
                  /* already gone */
                }
              }
            });
          } catch {
            /* effect support is optional for this plugin */
          }
          const bound = ctx.locale.bind(NS);
          t = (key) => {
            const value = bound(key);
            return value && value !== key ? value : fallback(key);
          };
        } catch {
          t = fallback;
        }

        const Panel = makePanel(ctx, t);
        const MoreRow = makeMoreRow(ctx, t);
        // Kept off the outer sidebar: the entry lives inside the sidebar's
        // "More" menu, so navigation stays quiet.
        ctx.slots.inject('sidebar.panellist.actions', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist.actions',
              id: 'codex-importer-more',
              order: -100,
              label: () => t('panel.title'),
            },
            MoreRow,
          ),
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'codex-importer' }, Panel),
        );
      },
    };
  },
});
