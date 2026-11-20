/**
 * 引擎回归测试。跑法：node --test test/
 *
 * 覆盖三类曾经真出过的问题：
 *  1. user/message 的正文在 data.content（不在 data.message.content）——「我发的」永远是 0 条；
 *  2. 系统回声（runtime-context / dsh-ops:step-tail / tool-jobs …）混进「我发的」；
 *  3. 检索词大小写、多词 AND、短语引号、score 排序与 title 伪文档。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { SearchEngine } from '../lib/engine.js'
import {
  assistantMessage,
  cleanup,
  sessionHeader,
  sessionTitle,
  tempRoot,
  toolCall,
  userMessage,
  writeSession,
} from './fixtures.mjs'

function seed() {
  const root = tempRoot('engine')
  writeSession(root, 'C--work-alpha', 'session-alpha', [
    sessionHeader('session-alpha', 'C:\\work\\alpha'),
    sessionTitle(1, 'Alpha 插件调研'),
    userMessage(2, '帮我看看 Jellyfin 在 NAS 上跑得怎么样'),
    assistantMessage(3, 'Jellyfin 的媒体库需要开启 EnablePhotos'),
    // 系统回声：都不该进「我发的」
    userMessage(4, 'runtime context 里提到 Jellyfin 但这不是人打的', 'runtime-context'),
    userMessage(5, 'step tail 同样是回声 Jellyfin', 'dsh-ops:step-tail'),
    userMessage(6, '工具任务收尾 Jellyfin', 'tool-jobs'),
    toolCall(7, 'Bash'),
  ])
  writeSession(root, 'C--work-beta', 'session-beta', [
    sessionHeader('session-beta', 'C:\\work\\beta', 1_700_100_000_000),
    userMessage(1, 'Everything 式的搜索要快'),
    assistantMessage(2, '线性扫描 30MB 只要十几毫秒'),
  ])
  return root
}

test('索引会话、标题与两种消息正文', () => {
  const root = seed()
  try {
    const engine = new SearchEngine(root)
    const stats = engine.reindexSync()
    assert.equal(stats.sessions, 2)
    // alpha: title + 2 条真人消息 + 1 条 assistant（3 条系统回声被丢掉）；beta: title + 1 user + 1 assistant，合计 6
    assert.equal(stats.docs, 6)
    assert.ok(stats.chars > 0)
    assert.equal(stats.progress, 1)

    const titles = engine.listSessions(10)
    assert.equal(titles.length, 2)
    assert.equal(titles[0].sid, 'session-beta', '最近更新的会话排在前面')
    assert.equal(titles.find((item) => item.sid === 'session-alpha').title, 'Alpha 插件调研')
  } finally {
    cleanup(root)
  }
})

test('「我发的」只包含真人消息', () => {
  const root = seed()
  try {
    const engine = new SearchEngine(root)
    engine.reindexSync()
    const { hits, total } = engine.search('Jellyfin', 50, { role: 'user' })
    assert.equal(total, 1)
    assert.equal(hits[0].seq, 2)
    assert.equal(hits[0].role, 'user')
    assert.match(hits[0].snippet, /NAS/)
  } finally {
    cleanup(root)
  }
})

test('多词 AND、大小写与短语', () => {
  const root = seed()
  try {
    const engine = new SearchEngine(root)
    engine.reindexSync()

    assert.equal(engine.search('jellyfin ENABLEPHOTOS').total, 1, '多词 AND 且大小写无关')
    assert.equal(engine.search('jellyfin 不存在').total, 0)
    assert.equal(engine.search('"Jellyfin 的媒体库"').total, 1, '引号短语按整串匹配')
    assert.equal(engine.search('""').total, 0, '空查询不返回结果')
  } finally {
    cleanup(root)
  }
})

test('title 伪文档与 titleOnly', () => {
  const root = seed()
  try {
    const engine = new SearchEngine(root)
    engine.reindexSync()
    const all = engine.search('Alpha', 10)
    assert.equal(all.hits[0].role, 'title', 'title 命中排在前面')
    const onlyTitle = engine.search('Alpha', 10, { titleOnly: true })
    assert.equal(onlyTitle.total, 1)
    assert.equal(onlyTitle.hits[0].seq, 0)
  } finally {
    cleanup(root)
  }
})

test('doc() 返回未折叠的原文与命中偏移', () => {
  const root = seed()
  try {
    const engine = new SearchEngine(root)
    engine.reindexSync()
    const found = engine.doc('session-alpha', 2, 'jellyfin')
    assert.equal(found.role, 'user')
    assert.equal(found.text, '帮我看看 Jellyfin 在 NAS 上跑得怎么样')
    assert.equal(found.text.slice(found.at, found.at + 8), 'Jellyfin')
    assert.equal(engine.doc('session-alpha', 999, ''), undefined)
  } finally {
    cleanup(root)
  }
})

test('增量 refresh 只重读变化过的文件', () => {
  const root = seed()
  try {
    const engine = new SearchEngine(root)
    engine.reindexSync()
    const before = engine.stats().docs

    const file = writeSession(root, 'C--work-beta', 'session-beta', [
      sessionHeader('session-beta', 'C:\\work\\beta', 1_700_100_000_000),
      userMessage(1, 'Everything 式的搜索要快'),
      userMessage(2, '新增一条关于 Plex 的消息'),
    ])
    const future = new Date(Date.now() + 5000)
    fs.utimesSync(file, future, future)

    return engine.refresh().then(() => {
      assert.equal(engine.search('Plex').total, 1)
      // beta 原本那条 assistant 消息在新版本里被删掉了，refresh 后不能还留着
      assert.equal(engine.search('线性扫描').total, 0, '旧消息被替换而不是累加')
      // 重写后 beta 只剩 2 条文档（1 user + 1 title），alpha 保持 4 条
      assert.equal(engine.stats().docs, 6)
      assert.ok(before > 0)
    })
  } finally {
    cleanup(root)
  }
})

test('ensureFresh 在阈值内不重复扫盘，并发 refresh 合并成一次', async () => {
  const root = seed()
  try {
    const engine = new SearchEngine(root)
    engine.reindexSync()

    // lastCheckAt 是私有字段，测试直接读它（运行时都在同一个对象上）
    engine.lastCheckAt = Date.now() - 1_000
    const stamp = engine.lastCheckAt
    await engine.ensureFresh(60_000)
    assert.equal(engine.lastCheckAt, stamp, '阈值内不应再扫')

    // 阈值 0 = 每次都扫（扫完检查时间戳会前进）
    await engine.ensureFresh(0)
    assert.ok(engine.lastCheckAt > stamp, '阈值 0 应真的扫了一次')

    // 并发调两次 refresh：内部合并，两次拿到的都是同一份结果对象的值
    const [a, b] = await Promise.all([engine.refresh(), engine.refresh()])
    assert.deepEqual(a, b)
  } finally {
    cleanup(root)
  }
})

test('权限不足或损坏的会话文件不会拖垮索引', () => {
  const root = tempRoot('broken')
  try {
    writeSession(root, 'C--work-alpha', 'session-alpha', [
      sessionHeader('session-alpha', 'C:\\work\\alpha'),
      userMessage(1, '正常的一条'),
    ])
    // 截断的 zstd
    const dir = root + '/C--work-alpha/session-broken'
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(dir + '/session.v4.jsonl.zstd', Buffer.from('not-zstd-at-all'))

    const engine = new SearchEngine(root)
    const stats = engine.reindexSync()
    assert.equal(engine.search('正常').total, 2, 'user 消息与 title 伪文档各命中一次')
    // 损坏文件不产生文档、也不抛错，正常会话的索引照旧可用；错误串留在 stats 里供排查
    assert.ok(stats.docs >= 2)
    assert.match(stats.error, /zstd|frame|descriptor/i)
  } finally {
    cleanup(root)
  }
})
