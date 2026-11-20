#!/usr/bin/env node
/**
 * 无依赖构建：把 src/*.ts 逐个用 Node 自带的 type-stripping 编译成 lib/*.js。
 *
 * 为什么不用 tsc / esbuild：本插件只有两个模块、零第三方依赖，而 Node 22.15+
 * 自带 --experimental-strip-types，编译只需一次 module.stripTypeScriptTypes。
 * 少一个构建链，克隆下来就能改、能跑。
 */
import fs from 'node:fs'
import path from 'node:path'
import module from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(here, '..', 'src')
const outDir = path.join(here, '..', 'lib')
fs.mkdirSync(outDir, { recursive: true })

const strip = module.stripTypeScriptTypes ?? (async (code) => code)
let count = 0
for (const entry of fs.readdirSync(srcDir)) {
  if (!entry.endsWith('.ts')) continue
  const source = fs.readFileSync(path.join(srcDir, entry), 'utf8')
  let js = await strip(source, { mode: 'strip' })
  // 源码里写 './engine.ts'（Node 直接运行 TS 的写法），产物要指向 './engine.js'
  js = js.replace(/(from\s+'\.\/[^']+)\.ts'/g, "$1.js'").replace(/(import\('\.\/[^']+)\.ts'\)/g, "$1.js')")
  fs.writeFileSync(path.join(outDir, entry.replace(/\.ts$/, '.js')), js)
  count += 1
}
console.log('built ' + count + ' module(s) into lib/')
