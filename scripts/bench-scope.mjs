import os from 'node:os'
import path from 'node:path'
import { SearchEngine } from '../lib/engine.js'

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const engine = new SearchEngine(path.join(home, 'sessions'), path.join(home, 'storages', 'dsh-search-everything'))
engine.reindexSync()

const list = engine.workspaces()
console.log('workspaces:', list.length)
for (const w of list) {
  console.log('  ', w.title.padEnd(14), String(w.sessions).padStart(4), 'sessions', String(w.docs).padStart(6), 'docs', (w.chars / 1048576).toFixed(1) + 'MB')
}
const big = list[0]
const terms = ['对话', '插件', '跳转', 'search', 'Everything']
console.log('\nquery            global            scoped(' + big.title + ')')
for (const q of terms) {
  let g = Infinity
  let s = Infinity
  let gt = 0
  let st = 0
  for (let i = 0; i < 3; i += 1) {
    const a = engine.search(q, 50)
    g = Math.min(g, a.tookMs)
    gt = a.total
    const b = engine.search(q, 50, { scope: big.cwd })
    s = Math.min(s, b.tookMs)
    st = b.total
  }
  console.log(q.padEnd(14), (gt + ' hits/' + g + 'ms').padEnd(18), st + ' hits/' + s + 'ms')
}

// 范围键归一：斜杠方向与大小写都算同一个工作区
const alt = big.cwd.replace(/\\/g, '/')
const same = engine.search('插件', 50, { scope: alt }).total
console.log('\nalt-slash scope total:', same, '==', engine.search('插件', 50, { scope: big.cwd }).total)
