/**
 * 语料索引核心（Host 半区）。
 *
 * 设计目标：Everything 式「输入即出结果」——查询路径上不碰磁盘。
 *
 * 取舍记录（都是在本机 223 个会话 / 16k 条消息 / 30MB 纯文本上实测出来的）：
 *  - 试过 trigram 位图倒排：建索引要在 30M 个字符位上各切一个 3 字串，实测建库
 *    23.5s、内存 714k 个 posting —— 换来的是单次查询 4ms，而裸扫本来就只要
 *    10ms 量级。收益 6ms、代价 23 秒启动，不划算，直接砍掉，改线性扫描。
 *  - FTS5 的 trigram 分词器对 CJK 实测失效（MATCH '对话' 返回 0 行），不能用。
 *  - 索引常驻内存、后台增量构建（每 8 个文件让一次事件循环），查询期零 IO。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/** 一条可检索的消息，或一条「会话标题」伪文档（seq=0、role=title）。 */
                            
             
               
             
                                 
                                      
                          
             
                  
              
                    
              
                         
               
 

                            
             
               
             
              
             
              
                     
                 
                                
                
                 
                
                            
                     
                                  
              
               
 

                              
                  
              
               
                          
                  
                   
                     
                     
                
 

/** 单条消息保留的最大字符数。 */
const MAX_TEXT = 8000
const SNIPPET_BEFORE = 40
const SNIPPET_AFTER = 120
/** 每处理多少个文件让一次事件循环。 */
const YIELD_EVERY = 6

                        
             
               
             
              
                 
              
 

function asText(part         )         {
  if (part !== null && typeof part === 'object') {
    const rec = part                           
    if ((rec.type === 'text' || rec.type === 'reasoning') && typeof rec.text === 'string') return rec.text
  }
  return ''
}

function contentText(content         )         {
  if (!Array.isArray(content)) return ''
  const parts           = []
  for (const item of content) {
    const t = asText(item)
    if (t !== '') parts.push(t)
  }
  return parts.join('\n')
}

/** 只解析我们真正要的行：日志里 60% 以上是 tool 事件，JSON.parse 它们纯属浪费。 */
function interestingLine(line        )          {
  return line.charCodeAt(0) === 123 /* { */ &&
    (line.includes('"user/message"') || line.includes('"assistant/message"') ||
      line.includes('"session/title"') || line.startsWith('{"type":"session"'))
}

/**
 * 哪些 user/message 是「人打的字」。
 *
 * 日志里 user/message 的 source.kind 有二十来种：只有 'user'/'user-approval'/'agent-message'
 * 连同空值算真正的输入，其余（runtime-context、dsh-ops:step-tail、tool-jobs、
 * repeat-tool-reminder、compact-checkpoint 等）都是机器塞进对话的系统回声。
 * 早期版本用「非空且不是 user 就跳过」的白名单反向判断，结果把 1186 条真人消息
 * 也一起丢掉了 —— 用户点了「我发的」tab 永远是 0 条。
 */
const HUMAN_SOURCES = new Set(['', 'user', 'user-approval', 'agent-message'])

function humanSourced(kind        )          {
  if (HUMAN_SOURCES.has(kind)) return true
  return kind.startsWith('dsh-ops:') && kind !== 'dsh-ops:step-tail'
}

function readSession(file        , sid        )                                                                  {
  const raw = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8')
  const docs              = []
  let title = ''
  let cwd = ''
  let firstTime = 0
  let lastTime = 0
  for (const line of raw.split('\n')) {
    if (line.length < 24 || !interestingLine(line)) continue
    let rec                         
    try {
      rec = JSON.parse(line)                           
    } catch {
      continue
    }
    const type = rec.type
    if (type === 'session') {
      if (typeof rec.cwd === 'string') cwd = rec.cwd
      if (typeof rec.createdAt === 'number') firstTime = rec.createdAt
      continue
    }
    const data = rec.data                                       
    if (data === undefined) continue
    if (type === 'session/title') {
      if (typeof data.title === 'string' && data.title !== '') title = data.title
      continue
    }
    // 两种记录的形状不一样：assistant/message 的内容挂在 data.message.content，
    // user/message 直接挂在 data.content。早期只看前者，于是「我发的」一条都进不了索引。
    const message = data.message                                       
    const content = message !== undefined ? message.content : data.content
    if (content === undefined) continue
    // 运行时上下文、工具尾巴、时间戳注入之类的回显不是人写的话，跳过。
    const source = data.source                                       
    const sourceKind = source !== undefined && typeof source.kind === 'string' ? source.kind : ''
    if (type === 'user/message' && !humanSourced(sourceKind)) continue
    const text = contentText(content).trim()
    if (text === '') continue
    const time = typeof rec.time === 'number' ? rec.time : 0
    if (time > lastTime) lastTime = time
    const clipped = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
    docs.push({
      sid,
      title: '',
      cwd,
      role: type === 'user/message' ? 'user' : 'assistant',
      seq: typeof rec.seq === 'number' ? rec.seq : 0,
      time,
      text: clipped,
      lower: clipped.toLowerCase(),
    })
  }
  const time = lastTime !== 0 ? lastTime : firstTime
  const resolved = title !== '' ? title : firstUserText(docs, sid)
  for (const doc of docs) {
    doc.title = resolved
    doc.cwd = cwd
  }
  return { docs, title: resolved, cwd, time }
}

function firstUserText(docs                                  , sid        )         {
  const first = docs.find((doc) => doc.role === 'user')
  if (first !== undefined) return first.text.replace(/\s+/g, ' ').slice(0, 40)
  return sid.slice(0, 16)
}

/** 查询拆词：空格分隔，双引号包住的当整串短语。 */
function termsOf(query        )           {
  const terms           = []
  const re = /"([^"]+)"|(\S+)/g
  let m                        
  while ((m = re.exec(query)) !== null) {
    const term = (m[1] ?? m[2] ?? '').trim().toLowerCase()
    if (term !== '') terms.push(term)
  }
  return terms
}

export class SearchEngine {
                   root        
          docs              = []
          sessions = new Map                      ()
          chars = 0
          indexing = false
          progress = 1
          lastIndexMs = 0
          lastIndexAt = 0
          error                    
          generation = 0
          lastCheckAt = 0
          checking                                  

  constructor(root        ) {
    this.root = root
  }

  stats()              {
    return {
      sessions: this.sessions.size,
      docs: this.docs.length,
      chars: this.chars,
      progress: this.progress,
      indexing: this.indexing,
      lastIndexMs: this.lastIndexMs,
      lastIndexAt: this.lastIndexAt,
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  /** 同步全量建库（测试/CLI 用）。 */
  reindexSync()              {
    this.docs = []
    this.sessions.clear()
    this.chars = 0
    const started = Date.now()
    for (const item of this.walk(this.root)) {
      const stat = safeStat(item.file)
      if (stat === undefined) continue
      this.indexFile(item.sid, item.file, stat.mtimeMs, stat.size)
    }
    this.lastIndexMs = Date.now() - started
    this.lastIndexAt = Date.now()
    this.progress = 1
    return this.stats()
  }

  /** 异步全量建库：每 YIELD_EVERY 个文件让一次事件循环，宿主不卡。 */
  async reindex()                       {
    if (this.indexing) return this.stats()
    const generation = ++this.generation
    this.indexing = true
    const started = Date.now()
    try {
      const files = [...this.walk(this.root)]
      this.docs = []
      this.sessions.clear()
      this.chars = 0
      let done = 0
      for (const item of files) {
        if (generation !== this.generation) return this.stats()
        const stat = safeStat(item.file)
        if (stat !== undefined) this.indexFile(item.sid, item.file, stat.mtimeMs, stat.size)
        done += 1
        this.progress = files.length === 0 ? 1 : done / files.length
        if (done % YIELD_EVERY === 0) await new Promise      ((resolve) => setImmediate(resolve))
      }
      this.error = undefined
      this.lastIndexMs = Date.now() - started
      this.lastIndexAt = Date.now()
      this.progress = 1
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.indexing = false
    }
    return this.stats()
  }

  /**
   * 按需增量：调用方（打开搜索框、配置了懒刷新的查询）要求时才扫。
   * minIntervalMs 内的重复调用直接返回，避免连打键盘时反复 stat 全库。
   */
  async ensureFresh(minIntervalMs = 0)                       {
    if (minIntervalMs > 0 && Date.now() - this.lastCheckAt < minIntervalMs) return this.stats()
    return this.refresh()
  }

  /** 增量：只重扫 mtime/size 变了的文件（会话日志是追加写的）。并发调用合并成一次。 */
  async refresh()                       {
    if (this.checking !== undefined) return this.checking
    const run = this.refreshOnce()
    this.checking = run
    try {
      return await run
    } finally {
      this.checking = undefined
    }
  }

          async refreshOnce()                       {
    if (this.indexing) return this.stats()
    const started = Date.now()
    this.indexing = true
    const seen = new Set        ()
    try {
      let work = 0
      for (const item of this.walk(this.root)) {
        seen.add(item.file)
        const stat = safeStat(item.file)
        if (stat === undefined) continue
        const known = this.sessions.get(item.file)
        if (known !== undefined && known.mtimeMs === stat.mtimeMs && known.size === stat.size) continue
        this.indexFile(item.sid, item.file, stat.mtimeMs, stat.size, known)
        work += 1
        if (work % YIELD_EVERY === 0) await new Promise      ((resolve) => setImmediate(resolve))
      }
      for (const [file, entry] of this.sessions) {
        if (seen.has(file)) continue
        this.dropSession(entry)
        this.sessions.delete(file)
      }
      this.lastIndexMs = Date.now() - started
      this.lastIndexAt = Date.now()
      this.lastCheckAt = Date.now()
      this.error = undefined
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.indexing = false
      this.lastCheckAt = Date.now()
    }
    return this.stats()
  }

  ;       *walk(dir        )                                           {
    let entries             
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        yield* this.walk(full)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.zstd')) continue
      yield { sid: path.basename(dir), file: full }
    }
  }

          indexFile(sid        , file        , mtimeMs        , size        , previous               )       {
    if (previous !== undefined) this.dropSession(previous)
    let parsed                                
    try {
      parsed = readSession(file, sid)
    } catch (error) {
      // 单个坏文件（写了一半、磁盘出错、压缩帧损坏）不该让整个索引停在半路：
      // 记下这一条错误，跳过它，其余会话照常可用。
      this.error = (error instanceof Error ? error.message : String(error)) + ' @ ' + path.basename(file)
      return
    }
    // 标题伪文档：让「按会话名找会话」也能命中，点进去直接落在会话顶部。
    const titleDoc            = {
      sid,
      title: parsed.title,
      cwd: parsed.cwd,
      role: 'title',
      seq: 0,
      time: parsed.time,
      text: parsed.title,
      lower: parsed.title.toLowerCase(),
    }
    const batch              = [titleDoc, ...parsed.docs]
    for (const doc of batch) {
      doc.title = parsed.title
      doc.cwd = parsed.cwd
      this.docs.push(doc)
      this.chars += doc.text.length
    }
    this.error = undefined
    this.sessions.set(file, { sid, title: parsed.title, cwd: parsed.cwd, file, mtimeMs, size })
  }

          dropSession(entry              )       {
    const before = this.docs.length
    const kept              = []
    for (const doc of this.docs) {
      if (doc.sid !== entry.sid) {
        kept.push(doc)
        continue
      }
      this.chars -= doc.text.length
    }
    if (kept.length !== before) this.docs = kept
  }

  /**
   * 查询：线性扫描 + 多词 AND。
   * 30MB 语料实测 4–10ms；先按「最长的词」过滤（最挑食），再验其余词。
   */
  search(query        , limit        , opts                                                       = {})   
                     
                 
                  
    {
    const started = Date.now()
    const terms = termsOf(query)
    if (terms.length === 0) return { hits: [], total: 0, tookMs: 0 }
    const ordered = [...terms].sort((a, b) => b.length - a.length)
    const perSession = new Map                ()
    const matched                                   = []
    for (const doc of this.docs) {
      if (opts.role !== undefined && opts.role !== '' && doc.role !== opts.role) continue
      if (opts.sid !== undefined && opts.sid !== '' && doc.sid !== opts.sid) continue
      if (opts.titleOnly === true && doc.role !== 'title') continue
      const at = doc.lower.indexOf(ordered[0]          )
      if (at < 0) continue
      let all = true
      for (let i = 1; i < ordered.length; i += 1) {
        if (!doc.lower.includes(ordered[i]          )) {
          all = false
          break
        }
      }
      if (!all) continue
      const firstAt = doc.lower.indexOf(terms[0]          )
      matched.push({ doc, at: firstAt >= 0 ? firstAt : at })
      perSession.set(doc.sid, (perSession.get(doc.sid) ?? 0) + 1)
    }
    const hits = matched.map(({ doc, at }                                ) =>
      this.makeHit(doc, terms[0]          , at, perSession.get(doc.sid) ?? 1))
    hits.sort((a, b) => b.score - a.score || b.time - a.time)
    return { hits: hits.slice(0, limit), total: matched.length, tookMs: Date.now() - started }
  }

          makeHit(doc           , q        , at        , sessionHits        )            {
    const from = Math.max(0, at - SNIPPET_BEFORE)
    const to = Math.min(doc.text.length, at + q.length + SNIPPET_AFTER)
    const prefix = from > 0 ? '…' : ''
    const suffix = to < doc.text.length ? '…' : ''
    const snippet = prefix + doc.text.slice(from, to).replace(/\s+/g, ' ') + suffix
    let score = 1
    const prev = doc.text[at - 1]
    if (at === 0 || prev === undefined || /[\s\p{P}]/u.test(prev)) score += 2
    if (doc.role === 'title') score += 3
    else if (doc.role === 'user') score += 0.8
    const ageDays = Math.max(0, (Date.now() - doc.time) / 86400000)
    score += 1.5 / (1 + ageDays / 7)
    return {
      sid: doc.sid,
      title: doc.title,
      cwd: doc.cwd,
      role: doc.role,
      seq: doc.seq,
      time: doc.time,
      snippet,
      offset: (at - from) + prefix.length,
      length: q.length,
      sessionHits,
      term: q,
      score,
    }
  }

  /**
   * 取某条消息的原文（跳转定位用）。
   *
   * 浏览器半区拿到的 snippet 折叠过空白、还带省略号，直接拿去在会话 DOM 里
   * indexOf 永远匹配不上；这里返回未加工的 text，让前端自己截连续短语。
   */
  doc(
    sid        ,
    seq        ,
    q = '',
  )                                                                                                 {
    const found = this.docs.find((item) => item.sid === sid && item.seq === seq && item.role !== 'title')
    if (found === undefined) return undefined
    const needle = q.toLowerCase()
    const at = needle === '' ? 0 : Math.max(0, found.lower.indexOf(needle))
    return { sid: found.sid, seq: found.seq, role: found.role, time: found.time, text: found.text, at }
  }

  /** 空查询时展示最近会话。 */
  listSessions(limit        )                                                                               {
    const counts = new Map                ()
    for (const doc of this.docs) counts.set(doc.sid, (counts.get(doc.sid) ?? 0) + 1)
    const rows = [...this.sessions.values()].map((entry) => ({
      sid: entry.sid,
      title: entry.title,
      cwd: entry.cwd,
      docs: counts.get(entry.sid) ?? 0,
      mtimeMs: entry.mtimeMs,
    }))
    rows.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return rows.slice(0, limit)
  }
}

function safeStat(file        )                       {
  try {
    return fs.statSync(file)
  } catch {
    return undefined
  }
}
