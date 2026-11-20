/**
 * dsh-search-everything —— 浏览器半区（无构建，宿主用 __ModuleLoader__ 直接加载）。
 *
 * 交互：
 *  - Ctrl/Cmd+K 打开全局搜索面板（侧栏也有入口，面板可被 Esc / 点遮罩关闭）。
 *  - 结果分三档：会话标题 / 用户提问 / 助手回复，↑↓ 选择、Enter 打开、Tab 切换过滤档。
 *  - 选中「消息」结果时：打开会话 → 在会话滚动容器里定位命中文本并高亮。
 *
 * 性能：输入 40ms 防抖 + 请求序号防乱序；后端是内存扫描（实测 8–45ms/次），
 * 所以真正做到「打字就有」。
 */
window.__ModuleLoader__.load({
  id: 'dsh-search-everything',
  factory: (require) => {
    const exports = {}

    const API = '/dsh-search-everything-api'
    const STYLE_ID = 'dsh-search-everything-style'
    const ENTRY_ATTR = 'data-dsh-search-everything-entry'

    /* ------------------------------- 样式 ------------------------------- */

    const CSS = [
      '.dse_backdrop{position:fixed;inset:0;z-index:1300;display:flex;justify-content:center;align-items:flex-start;',
      'padding:11vh 16px 24px;background:var(--dsw-alias-bg-mask-1);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}',
      '.dse_panel{width:min(760px,100%);max-height:min(70vh,640px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);',
      'border-radius:var(--dsw-radius-lg,14px);box-shadow:var(--dsw-elevation-prominent);overflow:hidden;',
      'border:.5px solid var(--dsw-alias-border-l2)}',
      '.dse_head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:.5px solid var(--dsw-alias-border-l3)}',
      '.dse_icon{width:16px;height:16px;flex:none;color:var(--dsw-alias-label-tertiary)}',
      '.dse_input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);',
      'font-size:15px;line-height:22px;font-family:inherit}',
      '.dse_input::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.dse_kbd{flex:none;font-size:11px;line-height:16px;padding:1px 6px;border-radius:5px;color:var(--dsw-alias-label-tertiary);',
      'background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}',
      '.dse_tabs{display:flex;gap:6px;padding:8px 12px 0;flex-wrap:wrap;align-items:center}',
      '.dse_scope{flex:none;margin-left:auto;max-width:190px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;',
      'text-align:left;font-size:11px;line-height:19px;padding:2px 9px;border-radius:999px;cursor:pointer;border:0;font-family:inherit;',
      'color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);',
      'box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}',
      '.dse_scope:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dse_scope[data-on="1"]{color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-2);',
      'box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-warn-primary)}',
      '.dse_chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l3);',
      'max-height:150px;overflow-y:auto;scrollbar-width:thin}',
      '.dse_chip{font-size:11.5px;line-height:19px;padding:2px 9px;border-radius:999px;cursor:pointer;border:0;font-family:inherit;',
      'color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);',
      'box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}',
      '.dse_chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dse_chip[data-on="1"]{color:var(--dsw-alias-state-warn-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-warn-primary)}',
      '.dse_chip[data-current="1"]{border:0;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}',
      '.dse_chipN{opacity:.6;margin-left:5px;font-variant-numeric:tabular-nums}',
      '.dse_tab{font-size:12px;line-height:20px;padding:2px 10px;border-radius:999px;cursor:pointer;border:0;',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:inherit}',
      '.dse_tab[data-on="1"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dse_list{flex:1;overflow-y:auto;padding:4px 6px 8px;scrollbar-width:thin}',
      '.dse_sect{padding:2px 0}',
      '.dse_sect+.dse_sect{border-top:.5px solid var(--dsw-alias-border-l3);margin-top:2px;padding-top:4px}',
      '.dse_sectHead{display:flex;align-items:baseline;gap:8px;padding:8px 10px 3px}',
      '.dse_sectTitle{font-size:11px;line-height:16px;font-weight:600;letter-spacing:.02em;',
      'color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dse_sectCount{flex:none;margin-left:auto;font-size:10.5px;line-height:15px;padding:0 6px;border-radius:999px;',
      'color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}',
      '.dse_item{display:flex;flex-direction:column;gap:3px;padding:7px 10px;border-radius:8px;cursor:pointer;',
      'border:0;background:transparent;text-align:left;width:100%;font-family:inherit;',
      'box-shadow:inset 0 -.5px 0 var(--dsw-alias-border-l3)}',
      '.dse_sect>.dse_item:last-child{box-shadow:none}',
      '.dse_item:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dse_item[data-active="1"]{background:var(--dsw-alias-bg-layer-3);',
      'box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2),inset 2.5px 0 0 var(--dsw-alias-state-warn-primary)}',
      '.dse_sect>.dse_item[data-active="1"]+.dse_item,.dse_item[data-active="1"]{box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2),inset 2.5px 0 0 var(--dsw-alias-state-warn-primary)}',
      '.dse_badge{flex:none;font-size:10px;line-height:15px;padding:0 5px;border-radius:4px;font-weight:600;',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);',
      'box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}',
      '.dse_badge[data-role="user"]{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}',
      '.dse_snip[data-role="user"]{color:var(--dsw-alias-label-primary)}',
      '.dse_line{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);display:flex;gap:7px;',
      'align-items:center;overflow:hidden;min-width:0}',
      '.dse_lineTime{flex:none;font-variant-numeric:tabular-nums}',
      '.dse_linePath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.7;direction:rtl;',
      'text-align:left;unicode-bidi:plaintext}',
      '.dse_snip{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary);',
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}',
      '.dse_line .dse_badge{align-self:center}',
      '.dse_mark{background:transparent;color:var(--dsw-alias-state-warn-primary);font-weight:700}',
      '.dse_meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap}',
      '.dse_foot{display:flex;align-items:center;gap:12px;padding:7px 14px;border-top:.5px solid var(--dsw-alias-border-l3);',
      'font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.dse_empty{padding:26px 14px;text-align:center;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
      '.dse_toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;',
      'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-md,10px);',
      'padding:9px 16px;font-size:13px;line-height:20px;box-shadow:var(--dsw-elevation-prominent)}',
      '.dse_entry{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 10px;border:0;border-radius:8px;',
      'background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-family:inherit;cursor:pointer}',
      '.dse_entry:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.dse_entryKey{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dse_hitFlash{outline:2px solid var(--dsw-alias-state-warn-primary);outline-offset:2px;border-radius:8px;',
      'transition:outline-color .4s ease}',
    ].join('')

    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      document.head.appendChild(el)
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    /**
     * 会话 DOM 文本的宽松归一：折叠空白、去掉空白与常见 markdown 记号。
     * 原文里的 `code`、**粗体**、列表符号渲染后都不在文本里，不归一就永远匹配不上。
     */
    function loose(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/[\s\u00a0]+/g, '')
        .replace(/[*_`>#|~]+/g, '')
    }

    function formatTime(time) {
      if (!time) return ''
      const d = new Date(time)
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes())
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    }

    /**
     * 取命中处的原文短语，用于在会话 DOM 里定位。
     *
     * 面板 snippet 经过空白折叠 + 省略号裁剪，不能直接当 needle；这里向 Host 要
     * 那一条消息的原文（/doc?sid&seq），按 offset 反推短语：以命中点为中心截取
     * 多个不同长度的片段，失败就退化成一个词、再退化成一个独立词。
     *
     * 片段必须「短且居中」：长片段横跨 markdown 记号、行内代码、换行时，渲染后的
     * DOM 与原文会有差异；而且当前会话 PR 内容是英文，命中点所在的用户原话在
     * DOM 里已经换成别的文本，能落地的往往是同一条消息里重复出现的短中文词。
     */
    async function needleAt(hit) {
      const fallback = String(hit.snippet || '').replace(/…/g, '').trim()
      let raw = ''
      let docAt = 0
      const term = String(hit.term || String(hit.snippet || '').replace(/…/g, '').trim())
      try {
        const doc = await api('/doc', { sid: hit.sid, seq: hit.seq, q: term })
        raw = String((doc && doc.text) || '')
        docAt = Number(doc && doc.at) || 0
      } catch {
        raw = ''
      }
      if (raw === '') return [fallback]
      // 从命中点向两侧各取一段原文，做成几个不同长度的候选短语：
      // 越长越精准，越短越抗「同一条消息被 DOM 拆成多个文本节点 / markdown 被渲染」。
      const at = Math.max(0, Math.min(raw.length, Number(docAt) || 0))
      const hitLen = Math.max(1, Number(hit.length) || term.length || 1)
      const out = []
      // 首选命中点两侧的原文片段，从短到长：短片段抗渲染差异，长片段抗歧义。
      const push = (piece) => {
        const clean = String(piece || '').replace(/\s+/g, ' ').trim()
        if (loose(clean).length >= 4 && !out.includes(clean)) out.push(clean)
      }
      for (const half of [7, 12, 18]) {
        push(raw.slice(Math.max(0, at - half), Math.min(raw.length, at + hitLen + half)))
      }
      // markdown 记号会把长片段切碎：再补一个「只取命中词上下文窗口内、去掉记号」的版本。
      push(loose(raw.slice(Math.max(0, at - 6), Math.min(raw.length, at + hitLen + 6))))
      // 退路：命中词 + 附近出现过的数字（序号、行号、端口这类锚点几乎不会重复）。
      const nums = (raw.slice(Math.max(0, at - 400), Math.min(raw.length, at + 400)).match(/\d{2,}/g) || []).slice(0, 4)
      for (const num of nums) {
        const piece = term === '' ? num : term + ' ' + num
        push(piece)
        if (loose(num).length >= 4) push(num)
      }
      if (term.length >= 3) push(term)
      // 同一条消息里被 DOM 拆成多个文本节点的情形：用命中点附近的连续中文片段兜底。
      const cjk = raw.slice(Math.max(0, at - 60), Math.min(raw.length, at + hitLen + 60)).match(/[\u4e00-\u9fa5A-Za-z0-9_\-]{4,12}/g) || []
      for (const word of cjk.slice(0, 6)) push(word)
      const words = fallback.split(/\s+/).filter((w) => w.length >= 2).slice(0, 3).join(' ')
      if (!out.includes(words)) out.push(words)
      return out.filter((item) => loose(item).length >= 3)
    }

    /**
     * 当前工作区（宿主侧视角）。
     *
     * 两处来源：会话容器的 data-conversation-session 指向某个会话时，从工作区快照里
     * 反查它的 path；否则退回已选中工作区的 path。都拿不到就只有「所有工作区」。
     */
    function currentScope(ctx) {
      const workspaces = serviceOf(ctx, 'workspaces')
      if (workspaces === undefined) return ''
      try {
        const snapshot = workspaces.list.getSnapshot()
        const items = Array.isArray(snapshot?.items) ? snapshot.items : []
        const node = document.querySelector('[data-conversation-session]')
        const sid = node === null ? '' : node.getAttribute('data-conversation-session') || ''
        if (sid !== '') {
          for (const item of items) {
            if (Array.isArray(item.sessionIds) && item.sessionIds.includes(sid)) return item.path || ''
          }
        }
        for (const item of items) {
          const active = item.workspaceId === snapshot?.state?.workspaceId || item.workspaceId === snapshot?.state?.activeWorkspaceId
          if (active && item.path) return item.path
        }
      } catch {}
      return ''
    }

    /** 工作区键：反斜杠压成斜杠、去掉尾斜杠、小写。与会话日志里的 cwd 归一方式一致。 */
    function scopeKey(value) {
      return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    }

    function scopeLabel(scope) {
      if (!scope) return '所有工作区'
      const parts = String(scope).replace(/\\/g, '/').replace(/\/+$/, '').split('/')
      return parts[parts.length - 1] || scope
    }

    function toast(text) {
      const el = document.createElement('div')
      el.className = 'dse_toast'
      el.textContent = text
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 2600)
    }

    function el(tag, className, text) {
      const node = document.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }

    /* ------------------------------ 后端访问 ------------------------------ */

    async function api(pathname, params) {
      const url = new URL(API + pathname, location.origin)
      for (const [k, v] of Object.entries(params || {})) {
        if (v !== '' && v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error('search failed: HTTP ' + res.status)
      return await res.json()
    }

    /* ------------------------------ 会话跳转 ------------------------------ */

    /** 消息块的选择器：命中后高亮这一层。 */
    const BLOCK = '[data-chat-flow-key],[class*="flowItem"],[class*="message"],[class*="turn"]'

    function serviceOf(ctx, name) {
      try {
        const service = ctx.get(name)
        return service === null ? undefined : service
      } catch {
        return undefined
      }
    }

    function uiWorkspaceOf(ctx) {
      return serviceOf(ctx, 'uiWorkspace')
    }

    function normalizePath(value) {
      return String(value || '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase()
    }

    /** 会话容器是否不存在（宿主没有连上任何工作区）。 */
    function detached() {
      return document.querySelector('[data-conversation-session]') === null
    }

    /** 等宿主把会话容器挂出来（连上工作区后 React 还要渲染一拍）。 */
    async function waitAttached(timeout) {
      const started = Date.now()
      while (Date.now() - started < timeout) {
        if (!detached()) return true
        await sleep(120)
      }
      return false
    }

    /**
     * 只在宿主「没连任何工作区」时才连一次工作区。
     *
     * 实测：宿主可以对任意工作区的会话直接 openSession（侧栏点别的工作区的会话就是这么做的），
     * 不需要先切工作区；反而是先 openWorkspace 会把导航状态搅乱 —— 它内部会新建/复用一个
     * blank 会话并把主视图指向它，紧接着的 openSession 会被这轮连接覆盖，最后停在
     * 「选择一个工作区开始」（会话容器不存在）。所以这里只处理「没连工作区」这一种情况：
     * 按会话 id / cwd 找到归属工作区，连上，等会话容器出现，再交给 openSession。
     */
    async function ensureWorkspace(ctx, sid, cwd) {
      if (!detached()) return
      const workspaces = serviceOf(ctx, 'workspaces')
      const workspace = uiWorkspaceOf(ctx)
      if (workspaces === undefined || workspace === undefined) return
      if (typeof workspace.openWorkspace !== 'function') return
      let items = []
      try {
        const snapshot = workspaces.list.getSnapshot()
        items = Array.isArray(snapshot.items) ? snapshot.items : []
      } catch {
        return
      }
      if (items.length === 0) return
      const path = normalizePath(cwd)
      const target = items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sid))
        || (path === '' ? undefined : items.find((item) => normalizePath(item.path) === path))
      if (target === undefined || target.workspaceId === undefined) return
      try {
        await workspace.openWorkspace(target.workspaceId)
      } catch {
        return
      }
      await waitAttached(6000)
    }

    /**
     * 会话是否还挂在某个工作区里。
     *
     * 已归档的会话不在任何工作区的 sessionIds 里，宿主对它 openSession 会**静默失败**：
     * replaceMain 把主视图指过去之后，归档守卫立刻 clearMain（selection 被写成 {}、
     * 会话容器消失、页面停在「选择一个工作区开始」），既没报错也没提示。
     */
    function attachedIn(ctx, sid) {
      const workspaces = serviceOf(ctx, 'workspaces')
      if (workspaces === undefined) return true
      try {
        const items = workspaces.list.getSnapshot().items || []
        return items.some((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sid))
      } catch {
        return true
      }
    }

    /** 已归档的会话先取消归档，否则跳转必然落空。 */
    async function unarchive(ctx, sid) {
      const workspaces = serviceOf(ctx, 'workspaces')
      if (workspaces === undefined || typeof workspaces.unarchiveSession !== 'function') return false
      try {
        await workspaces.unarchiveSession(sid)
        return true
      } catch {
        return false
      }
    }

    async function openSession(ctx, sid, cwd) {
      const workspace = uiWorkspaceOf(ctx)
      if (workspace !== undefined && workspace !== null && typeof workspace.openSession === 'function') {
        if (!attachedIn(ctx, sid)) {
          if (!(await unarchive(ctx, sid))) return false
          await sleep(80)
        }
        await ensureWorkspace(ctx, sid, cwd)
        workspace.openSession(sid)
        return true
      }
      // cordis 客户端 ctx 的服务属性访问被 trace：没在 inject 里声明的服务直接读会抛
      // 'cannot get property "sessions" without inject'，所以这里必须先探测再取。
      let sessions
      try {
        sessions = ctx.sessions
      } catch {
        sessions = undefined
      }
      if (sessions !== undefined && sessions !== null && typeof sessions.open === 'function') {
        sessions.open(sid)
        return true
      }
      try {
        location.hash = '#/session/' + sid
        return true
      } catch {
        return false
      }
    }

    /**
     * 在会话滚动容器内找含关键词的消息块（严格以 scroller 为根，避免命中侧栏标题）。
     *
     * 命中判断必须容忍「同一句话被拆成多个文本节点」（snippet 里的高亮 span、
     * markdown 的行内元素都会切碎文本）：逐文本节点匹配之外，再按消息块把块内
     * 所有文本节点拼成一段再匹配，命中后取该块做高亮目标。
     */
    function findInScroller(scroller, needle) {
      const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (!loose(node.nodeValue || '').includes(needle)) continue
        let node2 = node.parentElement
        for (let i = 0; i < 8 && node2 !== null; i += 1) {
          if (node2.matches && node2.matches(BLOCK)) return node2
          node2 = node2.parentElement
        }
        return node.parentElement
      }
      const blocks = scroller.querySelectorAll(BLOCK)
      for (const block of blocks) {
        if (loose(block.textContent || '').includes(needle)) return block
      }
      return null
    }

    function flash(node) {
      if (node === null) return
      node.classList.add('dse_hitFlash')
      setTimeout(() => node.classList.remove('dse_hitFlash'), 2600)
    }

    /**
     * 打开会话后定位命中文本。
     *
     * 会话视图是底部锚定的虚拟列表，初始只渲染末尾一屏；较早的消息不在 DOM 里，
     * 必须逐屏向上滚动把历史「喂」进 DOM 再找。滚动量取一屏的 85%（留重叠，
     * 免得正好跳过跨屏的消息块）；每轮都重新 querySelector —— 会话重挂载会换节点，
     * 缓存引用会写到 detached 节点上，白写。
     */
    async function jumpToText(candidates, sid) {
      const list = (Array.isArray(candidates) ? candidates : [candidates]).map((item) => loose(item)).filter((item) => item.length >= 4)
      const q = list[0] || ''
      const found = (box) => {
        for (const candidate of list) {
          const node = findInScroller(box, candidate)
          if (node !== null) return node
        }
        return null
      }
      if (q === '') return
      const started = Date.now()
      const getScroller = () => document.querySelector('[data-conversation-scroll]')
      // 会话切换是「同一个滚动容器换内容」：不确认换好了就开滚，会滚的是上一个会话。
      const mounted = () => {
        if (!sid) return true
        const node = document.querySelector('[data-conversation-session]')
        if (node === null) return true
        const value = node.getAttribute('data-conversation-session') || ''
        return value === '' || value === sid
      }
      const mountDeadline = Date.now()
      while (Date.now() - mountDeadline < 10000) {
        if (mounted()) break
        await sleep(120)
      }
      let scroller = null
      while (Date.now() - started < 8000) {
        scroller = getScroller()
        if (scroller !== null) break
        await sleep(150)
      }
      if (scroller === null) {
        toast('会话已打开，但没找到可定位的对话区域')
        return
      }
      // 会话打开后消息是异步渲染的：DOM 里还没有正文就往上滚，会滚到「加载更早」
      // 的空区域并把位置丢掉。先等内容落地（或超时），再开始逐屏回滚。
      const contentAt = (box) => loose(box ? box.textContent || '' : '').length
      const flowCount = (box) => (box === null ? 0 : box.querySelectorAll('[data-chat-flow-key]').length)
      const waitContent = Date.now()
      while (Date.now() - waitContent < 10000) {
        const box = getScroller()
        if (box !== null && flowCount(box) >= 5) {
          break
        }
        await sleep(120)
      }
      const signature = (box) => box.innerHTML.length + ':' + box.scrollHeight
      const baseline = signature(scroller)
      for (let i = 0; i < 6; i += 1) {
        await sleep(150)
        const current = getScroller()
        if (current !== null && signature(current) !== baseline) break
      }
      let lastHeight = -1
      let stall = 0
      while (Date.now() - started < 20000) {
        const box = getScroller()
        if (box === null) {
          await sleep(200)
          continue
        }
        const hit = found(box)
        if (hit !== null) {
          // 必须用瞬时滚动：smooth 的动画会被「吸底」逻辑逐帧拽回底部。
          hit.scrollIntoView({ block: 'center', behavior: 'auto' })
          flash(hit)
          return
        }
        if (box.scrollHeight === lastHeight) stall += 1
        else stall = 0
        lastHeight = box.scrollHeight
        if (stall > 12) break
        if (box.scrollTop <= 0) {
          // 到顶且没命中：可能历史还在「加载更早」，等它长出来再判死。
          if (stall > 6) break
          if (contentAt(box) < 240 && Date.now() - started < 12000) {
            await sleep(300)
            continue
          }
          if (stall > 3) break
          await sleep(200)
          continue
        }
        box.scrollTop = Math.max(0, box.scrollTop - Math.max(240, box.clientHeight * 0.85))
        await sleep(160)
      }
      toast('已打开会话，但没滚动到命中的那条消息')
    }

    /* ------------------------------ 面板 UI ------------------------------ */

    const TABS = [
      { id: 'all', label: '全部' },
      { id: 'title', label: '会话' },
      { id: 'user', label: '我发的' },
      { id: 'assistant', label: '助手回复' },
    ]

    function mount(ctx, closeAll) {
      let backdrop = null
      let input = null
      let list = null
      let foot = null
      let rows = []
      let active = 0
      let tab = 'all'
      let series = 0
      let debounce = null
      let lastQuery = ''
      /** 空串 = 所有工作区。收窄后查询只扫那个工作区的文档，不发全库再过滤。 */
      let scope = ''
      let chipsRow = null
      let scopeBtn = null
      let chipNodes = []

      function build() {
        scope = currentScope(ctx)
        backdrop = el('div', 'dse_backdrop')
        const panel = el('div', 'dse_panel')
        const head = el('div', 'dse_head')
        const icon = document.createElement('span')
        icon.className = 'dse_icon'
        icon.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 14 14"/></svg>'
        input = el('input', 'dse_input')
        input.type = 'text'
        input.placeholder = '搜索全部会话内容…  支持多个词，空格分隔，用 "双引号" 锁短语'
        input.spellcheck = false
        const kbd = el('span', 'dse_kbd', navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K')
        head.append(icon, input, kbd)

        const tabs = el('div', 'dse_tabs')
        for (const item of TABS) {
          const btn = el('button', 'dse_tab', item.label)
          btn.dataset.tab = item.id
          btn.dataset.on = item.id === tab ? '1' : '0'
          btn.addEventListener('click', () => {
            tab = item.id
            for (const other of tabs.children) other.dataset.on = other.dataset.tab === tab ? '1' : '0'
            void run(input.value)
          })
          tabs.appendChild(btn)
        }
        scopeBtn = el('button', 'dse_scope')
        scopeBtn.type = 'button'
        scopeBtn.title = '限定搜索范围（Ctrl+W 切换）'
        scopeBtn.textContent = '所有工作区'
        scopeBtn.dataset.on = '0'
        syncScopeBtn()
        scopeBtn.addEventListener('click', () => {
          chipsRow.hidden = !chipsRow.hidden
          if (!chipsRow.hidden) void loadWorkspaces()
        })
        const sep = el('span', 'dse_kbd', '范围')
        tabs.append(sep, scopeBtn)

        chipsRow = el('div', 'dse_chips')
        chipsRow.hidden = true
        chipsRow.addEventListener('keydown', onKey)

        list = el('div', 'dse_list')
        foot = el('div', 'dse_foot', '正在读取索引…')

        panel.append(head, tabs, chipsRow, list, foot)
        backdrop.appendChild(panel)
        backdrop.addEventListener('mousedown', (event) => {
          if (event.target === backdrop) closeAll()
        })
        input.addEventListener('input', () => {
          if (debounce !== null) clearTimeout(debounce)
          debounce = setTimeout(() => void run(input.value), 40)
        })
        input.addEventListener('keydown', onKey)
        document.body.appendChild(backdrop)
        input.focus()
        void showRecent()
        void warmup()
      }

      function syncScopeBtn() {
        if (scopeBtn === null) return
        scopeBtn.textContent = scopeLabel(scope)
        scopeBtn.dataset.on = scope === '' ? '0' : '1'
        scopeBtn.title = scope === '' ? '限定搜索范围（Ctrl+W 切换）' : '只在这个工作区里搜：' + scope + '（Ctrl+W 切换）'
      }

      /** 应用一个范围并立刻重跑当前查询（打开面板时还会预置成当前工作区）。 */
      function setScope(next) {
        scope = String(next || '')
        syncScopeBtn()
        for (const node of chipNodes) node.dataset.on = scopeKey(node.dataset.cwd || '') === scopeKey(scope) ? '1' : '0'
        if (lastQuery === '') void showRecent()
        else void run(lastQuery)
      }

      /** 工作区列表：次数 + 消息数一眼可见，用户按「哪个仓」挑，不用记路径。 */
      async function loadWorkspaces() {
        let data
        try {
          data = await api('/workspaces', {})
        } catch {
          return
        }
        const here = scopeKey(currentScope(ctx))
        chipNodes = []
        chipsRow.textContent = ''
        const all = el('button', 'dse_chip', '所有工作区')
        all.type = 'button'
        all.dataset.cwd = ''
        all.dataset.on = scope === '' ? '1' : '0'
        all.addEventListener('click', () => setScope(''))
        chipNodes.push(all)
        chipsRow.appendChild(all)
        for (const item of data.workspaces || []) {
          if (!item.cwd) continue
          const chip = el('button', 'dse_chip', item.title || scopeLabel(item.cwd))
          chip.type = 'button'
          chip.title = item.cwd + '（' + item.sessions + ' 个会话）'
          chip.dataset.cwd = item.cwd
          chip.dataset.on = scopeKey(item.cwd) === scopeKey(scope) ? '1' : '0'
          if (scopeKey(item.cwd) === here) chip.dataset.current = '1'
          const count = el('span', 'dse_chipN', String(item.docs))
          chip.appendChild(count)
          chip.addEventListener('click', () => setScope(item.cwd))
          chipNodes.push(chip)
          chipsRow.appendChild(chip)
        }
      }

      /**
       * 打开面板即触发一次增量扫描：索引平时完全不巡检磁盘，靠这一下变新鲜。
       * 扫完若用户还没开始输入（仍是最近列表），就把列表与页脚换成最新数据。
       */
      async function warmup() {
        const mine = series
        try {
          const data = await api('/refresh', {})
          if (mine !== series) return
          if (lastQuery === '') void showRecent()
          else void run(lastQuery)
        } catch {
          // 刷新失败不影响已有索引，静默即可。
        }
      }

      function teardown() {
        if (debounce !== null) clearTimeout(debounce)
        if (backdrop !== null) backdrop.remove()
        backdrop = null
      }

      function cycleTab(step) {
        const at = TABS.findIndex((item) => item.id === tab)
        tab = TABS[(at + step + TABS.length) % TABS.length].id
        for (const node of backdrop.querySelectorAll('.dse_tab')) node.dataset.on = node.dataset.tab === tab ? '1' : '0'
        void run(input.value)
      }

      function onKey(event) {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeAll()
          return
        }
        if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
          event.preventDefault()
          move(1)
          return
        }
        if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
          event.preventDefault()
          move(-1)
          return
        }
        if (event.key === 'Tab') {
          event.preventDefault()
          cycleTab(event.shiftKey ? -1 : 1)
          return
        }
        // Ctrl+W 开合范围条；打开时 ←/→ 在范围之间切换（都被这里先吃掉，不进输入框）。
        if (event.key === 'w' && event.ctrlKey) {
          event.preventDefault()
          if (chipsRow !== null) {
            chipsRow.hidden = !chipsRow.hidden
            if (!chipsRow.hidden) void loadWorkspaces()
          }
          return
        }
        if (chipsRow !== null && !chipsRow.hidden && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault()
          moveChip(event.key === 'ArrowRight' ? 1 : -1)
          return
        }
        // 输入框里专注打字时，左右方向键留给光标；空查询时才用来切 tab。
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          if (input.value !== '') return
          event.preventDefault()
          cycleTab(event.key === 'ArrowRight' ? 1 : -1)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          void activate(rows[active])
        }
      }

      // 范围条上的左右移动：开合只是 visibility，焦点留在输入框，键盘不必换手。
      function moveChip(step) {
        if (chipNodes.length === 0) return
        const at = chipNodes.findIndex((node) => node.dataset.on === '1')
        const next = chipNodes[(((at < 0 ? 0 : at) + step) % chipNodes.length + chipNodes.length) % chipNodes.length]
        if (next === undefined) return
        setScope(next.dataset.cwd || '')
        next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }

      function move(delta) {
        if (rows.length === 0) return
        active = (active + delta + rows.length) % rows.length
        const nodes = list.querySelectorAll('.dse_item')
        nodes.forEach((node, index) => {
          node.dataset.active = index === active ? '1' : '0'
        })
        const current = nodes[active]
        if (current !== undefined) current.scrollIntoView({ block: 'nearest' })
      }

      function markSnippet(snippet, offset, length) {
        const wrap = el('div', 'dse_snip')
        if (offset < 0 || length <= 0) {
          wrap.textContent = snippet
          return wrap
        }
        const before = snippet.slice(0, offset)
        const hit = snippet.slice(offset, offset + length)
        const after = snippet.slice(offset + length)
        wrap.append(document.createTextNode(before), el('span', 'dse_mark', hit), document.createTextNode(after))
        return wrap
      }

      function renderList(hits, stats) {
        rows = hits
        active = 0
        list.textContent = ''
        if (hits.length === 0) {
          const empty = el('div', 'dse_empty')
          empty.textContent = lastQuery === '' ? '还没有会话数据（正在建库：' + Math.round((stats?.progress ?? 0) * 100) + '%）' : '没有匹配的内容'
          list.appendChild(empty)
          foot.textContent = ''
          return
        }
        // 同一会话的命中归入一个区块：区块之间有分隔线，区块头显示会话标题与命中数。
        const groups = new Map()
        hits.forEach((hit, index) => {
          let bucket = groups.get(hit.sid)
          if (bucket === undefined) {
            bucket = { title: hit.title || hit.sid.slice(0, 12), hits: [] }
            groups.set(hit.sid, bucket)
          }
          bucket.hits.push({ hit, index })
        })
        let flat = 0
        groups.forEach((bucket) => {
          const section = el('div', 'dse_sect')
          const head = el('div', 'dse_sectHead')
          head.append(
            el('span', 'dse_sectTitle', bucket.title),
            el('span', 'dse_sectCount', String(bucket.hits.length)),
          )
          section.appendChild(head)
          for (const entry of bucket.hits) {
            const hit = entry.hit
            const index = entry.index
            flat += 1
            const item = el('button', 'dse_item')
          item.dataset.active = index === 0 ? '1' : '0'
          item.dataset.index = String(index)
          // 主文是命中片段；下面一行只放归属信息（角色 + 时间 + 路径），避免与会话标题重复。
          const snip = markSnippet(hit.snippet, hit.offset, hit.length)
          if (hit.role === 'user') snip.dataset.role = 'user'
          item.appendChild(snip)
          const line = document.createElement('div')
          line.className = 'dse_line'
          const badge = el('span', 'dse_badge', hit.role === 'title' ? '会话' : hit.role === 'user' ? '我' : '助手')
          if (hit.role === 'user') badge.dataset.role = 'user'
          line.append(badge, el('span', 'dse_lineTime', formatTime(hit.time)))
          if (hit.cwd) line.append(el('span', 'dse_linePath', hit.cwd))
          item.appendChild(line)
            item.addEventListener('mouseenter', () => {
              active = index
              list.querySelectorAll('.dse_item').forEach((node) => {
                node.dataset.active = node.dataset.index === String(index) ? '1' : '0'
              })
            })
            item.addEventListener('click', () => void activate(hit))
            section.appendChild(item)
          }
          list.appendChild(section)
        })
      }

      async function run(rawQuery) {
        const q = String(rawQuery || '').trim()
        lastQuery = q
        if (q === '') {
          void showRecent()
          return
        }
        const mine = ++series
        try {
          const params = { q, limit: 60, scope }
          if (tab !== 'all') {
            if (tab === 'title') params.titleOnly = '1'
            else params.role = tab
          }
          const data = await api('/query', params)
          if (mine !== series) return
          const hits = (data.hits || []).filter((hit) => tab === 'all' || (tab === 'title' ? hit.role === 'title' : hit.role === tab))
          renderList(hits, data.stats)
          const stats = data.stats || {}
          const cost = stats.indexing ? '建库中 ' + Math.round((stats.progress ?? 0) * 100) + '%' : '索引 ' + (stats.docs ?? 0) + ' 条消息 / ' + sizeLabel(stats.chars ?? 0)
          const where = scope === '' ? '' : ' · 仅 ' + scopeLabel(scope)
          foot.textContent = data.total + ' 处命中 · ' + data.tookMs + 'ms' + where + ' · ' + cost
        } catch (error) {
          if (mine !== series) return
          list.textContent = ''
          list.appendChild(el('div', 'dse_empty', '搜索失败：' + (error && error.message ? error.message : String(error))))
        }
      }

      function sizeLabel(chars) {
        if (chars < 1048576) return Math.max(1, Math.round(chars / 1024)) + 'KB'
        return (chars / 1048576).toFixed(1) + 'MB'
      }

      async function showRecent() {
        const mine = ++series
        try {
          const data = await api('/sessions', { limit: 20, scope })
          if (mine !== series) return
          const rowsRecent = (data.sessions || []).map((item) => ({
            sid: item.sid,
            title: item.title,
            cwd: item.cwd,
            role: 'title',
            snippet: item.title,
            offset: 0,
            length: 0,
            sessionHits: item.docs,
            seq: 0,
            time: item.mtimeMs,
          }))
          renderList(rowsRecent, data.stats)
          const stats = data.stats || {}
          const where = scope === '' ? '' : ' · 仅 ' + scopeLabel(scope)
          foot.textContent = stats.docs + ' 条消息 · ' + (stats.sessions ?? 0) + ' 个会话' + where + ' · 输入即搜'
        } catch {
          list.textContent = ''
          list.appendChild(el('div', 'dse_empty', '后端未就绪，稍后再试'))
        }
      }

      async function activate(hit) {
        if (hit === undefined) return
        const opened = await openSession(ctx, hit.sid, hit.cwd)
        if (!opened) {
          toast('当前宿主不支持直接打开会话')
          return
        }
        // 定位用「原始文本里的连续短语」：先拿命中位置的原文，再退化成第一个词。
        // 面板里的 snippet 折叠过空白并插了省略号，直接当 needle 永远匹配不上。
        let needle = ''
        // 先收面板再定位：面板只在事件里出现，收掉它不会打断后面的 await 流程。
        closeAll()
        if (hit.role !== 'title') {
          needle = await needleAt(hit)
          if (needle.length > 0) await jumpToText(needle, hit.sid)
        }
      }

      build()
      return teardown
    }

    /* ------------------------------ 侧栏入口 ------------------------------ */

    /* ------------------------------- 装配 ------------------------------- */

    /**
     * 侧栏入口。
     *
     * 宿主的面板导航是 React 渲染的，直接 appendChild 会被下一次 reconcile 抹掉；
     * 用 MutationObserver 盯着（幂等：已经在位就不动），宿主重排后自动补回。
     * 找不到面板导航时退化成完全靠快捷键，不影响主功能。
     */
    function mountEntry(openPalette) {
      const existing = () => document.querySelector('[' + ENTRY_ATTR + ']')
      const entry = existing() ?? (() => {
        const node = el('button', 'dse_entry')
        node.setAttribute(ENTRY_ATTR, '')
        node.title = '全局搜索（Ctrl+K）'
        const icon = document.createElement('span')
        icon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 14 14"/></svg>'
        node.append(icon, el('span', '', '搜索'), el('span', 'dse_entryKey', 'Ctrl K'))
        node.addEventListener('click', (event) => {
          event.preventDefault()
          openPalette()
        })
        return node
      })()

      const panelNav = () => {
        const row = document.querySelector('[class*="panelRow"]')
        return row === null ? null : row.parentElement
      }
      let placed = false
      const tryPlace = () => {
        const parent = panelNav()
        if (parent === null) return
        if (entry.parentElement !== parent) parent.appendChild(entry)
        placed = true
      }
      const observer = new MutationObserver(tryPlace)
      observer.observe(document.body, { childList: true, subtree: true })
      tryPlace()
      return () => {
        observer.disconnect()
        entry.remove()
      }
    }

    // inject 只声明「宿主必须先加载哪些插件包」（包名，不是服务名）；
    // 服务用 ctx.get() 探测式获取，不声明也能挂载。
    exports.inject = []
    exports.apply = (ctx) => {
      ctx.effect(() => {
        try {
          ensureStyle()
        } catch {}
        let teardown = null

        const closeAll = () => {
          if (teardown !== null) teardown()
          teardown = null
        }
        const openPalette = () => {
          if (teardown !== null) return
          teardown = mount(ctx, closeAll)
        }

        // Ctrl/Cmd+K 用捕获阶段监听：宿主自己的快捷键层不会先把它吞掉。
        const onKeydown = (event) => {
          const key = (event.key || '').toLowerCase()
          if (key !== 'k') return
          if (!(event.metaKey || event.ctrlKey)) return
          if (event.altKey) return
          const target = event.target
          if (target !== null && target.closest !== undefined && target.closest('[data-dse-ignore-hotkey]') !== null) return
          event.preventDefault()
          event.stopPropagation()
          if (teardown !== null) closeAll()
          else openPalette()
        }
        document.addEventListener('keydown', onKeydown, true)

        let unmountEntry = () => {}
        try {
          unmountEntry = mountEntry(openPalette)
        } catch {}

        return () => {
          document.removeEventListener('keydown', onKeydown, true)
          unmountEntry()
          closeAll()
          document.getElementById(STYLE_ID)?.remove()
        }
      })
    }

    return exports
  },
})
