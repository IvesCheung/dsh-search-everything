/**
 * 冷启动 vs 磁盘索引恢复的对照基准。
 * 跑法：node scripts/bench-cache.mjs [缓存目录]
 *
 * 语料就是本机 ~/.dsh/sessions（不是合成数据），所以数字会随会话量变化。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { SearchEngine } from '../lib/engine.js'

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const root = path.join(home, 'sessions')
const cacheDir = process.argv[2] ?? path.join(home, 'storages', 'dsh-search-everything')

function time(label, fn) {
  const started = Date.now()
  const value = fn()
  console.log(label.padEnd(34), String(Date.now() - started).padStart(6), 'ms')
  return value
}

if (!fs.existsSync(root)) {
  console.log('no sessions at', root)
  process.exit(1)
}

console.log('sessions root:', root)
console.log('cache dir    :', cacheDir)

// 1) 冷启动：清掉缓存，全量解压 + 解析
fs.rmSync(cacheDir, { recursive: true, force: true })
const cold = new SearchEngine(root, cacheDir)
const coldStats = time('cold build (no cache)', () => cold.reindexSync())
time('cold flush to disk', () => cold.flush())
console.log('  docs', coldStats.docs, 'chars', coldStats.chars, 'cache bytes', cold.stats().cache.bytes)

// 2) 热启动：读回索引 + 增量校验
const warm = new SearchEngine(root, cacheDir)
const warmStats = time('warm start (restore+verify)', () => warm.reindexSync())
console.log('  hit', warmStats.cache.hit, 'restore ms', warmStats.cache.loadMs, 'docs', warmStats.docs)

for (const q of ['对话', '插件', '跳转', 'search', 'Everything']) {
  const first = warm.search(q, 50)
  const runs = [first.tookMs]
  for (let i = 0; i < 2; i += 1) runs.push(warm.search(q, 50).tookMs)
  console.log('  query', q.padEnd(12), String(Math.min(...runs)).padStart(4), 'ms', String(first.total).padStart(5), 'hits')
}
