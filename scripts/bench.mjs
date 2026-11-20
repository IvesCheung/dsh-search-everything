/**
 * 基准：真实语料下的建库与查询耗时。
 *
 *   node scripts/bench.mjs [查询词…]
 *
 * 默认在 ~/.dsh/sessions（或 $DSH_HOME/sessions）上跑；只读，不改任何东西。
 */
import os from 'node:os'
import path from 'node:path'

import { SearchEngine } from '../lib/engine.js'

const root = process.env.DSE_SESSIONS_ROOT ?? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'sessions')
const queries = process.argv.slice(2)
if (queries.length === 0) queries.push('对话', '插件', '跳转', 'search', 'Everything')

const engine = new SearchEngine(root)
const built = engine.reindexSync()
console.log('[index] ' + JSON.stringify({ sessions: built.sessions, docs: built.docs, chars: built.chars, ms: built.lastIndexMs }))

for (const query of queries) {
  // 第一轮包含一次冷启动的引擎内 JIT，跑三轮取最好成绩
  const timings = []
  let total = 0
  for (let round = 0; round < 3; round += 1) {
    const result = engine.search(query, 50)
    timings.push(result.tookMs)
    total = result.total
  }
  console.log('[query] ' + JSON.stringify({ query, total, ms: Math.min(...timings), rounds: timings }))
}
