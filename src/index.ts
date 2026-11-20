/**
 * dsh-search-everything —— Host 半区。
 *
 * 职责：把 ~/.dsh/sessions 下的全部会话日志索引进内存，并通过一条 prefix 路由
 * 暴露给浏览器半区（不抢宿主 fallback，也不占用 /api 这个客户端连接专属命名空间）：
 *   GET /dsh-search-everything-api/query?q=&limit=&role=&sid=
 *   GET /dsh-search-everything-api/sessions?limit=
 *   GET /dsh-search-everything-api/stats
 *
 * 索引策略（实测依据见 src/engine.ts 头注释）：
 *  - 启动后异步全量建库（每 6 个文件让一次事件循环），期间 /query 先回答空结果 + indexing 标记；
 *  - 之后每 5s 增量巡检一次 mtime/size，变了才重读那个文件；
 *  - 查询全程内存，实测 16k 条消息 / 28MB 文本下单次 8–45ms。
 */
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SearchEngine } from './engine.ts'

export const name = 'dsh-search-everything'

export interface Config {
  /** 索引巡拣间隔（毫秒）；0 关闭增量巡检。 */
  refreshIntervalMs?: number
  /** 单次查询返回上限。 */
  maxResults?: number
  /** 会话根目录；默认 $DSH_HOME/sessions 或 ~/.dsh/sessions。 */
  sessionsRoot?: string
}

interface WebRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}

interface WebResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: any, res: any) => void | Promise<void>
  }): () => void
}

/**
 * 路由前缀。刻意不挂在 /api 下：/api 是 dsh-client-connection 独占的客户端连接命名空间，
 * 它把自己注册成 kind:"prefix" path:"/api"，任何走不到 peer 鉴权的请求都会被它 401 掉。
 */
export const API_PREFIX = '/dsh-search-everything-api'

function isLoopback(address: string | undefined): boolean {
  if (address === undefined || address === '') return false
  return address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

function writeJson(res: WebResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

function defaultSessionsRoot(): string {
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return path.join(home, 'sessions')
  return path.join(os.homedir(), '.dsh', 'sessions')
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function apply(ctx: Context, config: Config = {}): void {
  const root = config.sessionsRoot ?? defaultSessionsRoot()
  const engine = new SearchEngine(root)
  const maxResults = clamp(config.maxResults ?? 50, 1, 200)
  const refreshIntervalMs = clamp(config.refreshIntervalMs ?? 5000, 0, 600000)

  // 首屏不等：先让插件激活成功，建库在后台自己跑完。
  void engine.reindex().catch(() => {})

  let timer: any
  const disposeTimer = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  const admit = (req: WebRequest): boolean => {
    // 只服务本机回环：会话正文属于用户私有数据，宿主即便绑在局域网地址上也不外泄。
    const remote = req.socket?.remoteAddress
    return isLoopback(remote)
  }

  // 宿主半区取服务必须走 ctx.inject([...])：cordis 的 service 访问是被 trace 的，
  // 直接读 ctx.webServer 会抛 'cannot get property "webServer" without inject'，
  // 整个插件条目会被判为未激活（实测：dsh web 日志里 "1 entry did not activate"）。
  ctx.inject(['webServer'], (webCtx) => {
    const server = (webCtx as unknown as { webServer?: WebServerLike }).webServer
    if (server === undefined) return
    return run(server)
  })

  function run(server: WebServerLike) {
    return ctx.effect(() => {
      if (refreshIntervalMs > 0) {
        timer = setInterval(() => {
          void engine.refresh().catch(() => {})
        }, refreshIntervalMs)
        timer.unref?.()
      }

      const dispose: Array<() => void> = []

      dispose.push(server.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        const r = req as unknown as WebRequest
        const out = res as unknown as WebResponse
        if (!admit(r)) {
          writeJson(out, 403, { error: 'loopback only' })
          return
        }
        const url = new URL('http://localhost' + (r.url ?? '/'))
        const sub = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '')
        if (r.method !== 'GET' && r.method !== 'HEAD') {
          writeJson(out, 405, { error: 'method not allowed' })
          return
        }
        if (sub === 'query') {
          const q = url.searchParams.get('q') ?? ''
          const limit = clamp(Number(url.searchParams.get('limit') ?? '40') || 40, 1, maxResults)
          const role = url.searchParams.get('role') ?? ''
          const sid = url.searchParams.get('sid') ?? ''
          const titleOnly = url.searchParams.get('titleOnly') === '1'
          const result = engine.search(q, limit, { role, sid, titleOnly })
          writeJson(out, 200, { ok: true, query: q, ...result, stats: engine.stats() })
          return
        }
        if (sub === 'sessions') {
          const limit = clamp(Number(url.searchParams.get('limit') ?? '30') || 30, 1, 200)
          writeJson(out, 200, { ok: true, sessions: engine.listSessions(limit), stats: engine.stats() })
          return
        }
        if (sub === 'doc') {
          const doc = engine.doc(
            url.searchParams.get('sid') ?? '',
            Number(url.searchParams.get('seq') ?? '0') || 0,
            url.searchParams.get('q') ?? '',
          )
          if (doc === undefined) {
            writeJson(out, 404, { error: 'not found' })
            return
          }
          writeJson(out, 200, { ok: true, ...doc })
          return
        }
        if (sub === 'stats') {
          writeJson(out, 200, { ok: true, stats: engine.stats() })
          return
        }
        writeJson(out, 404, { error: 'not found' })
      },
    }))

      return () => {
        for (const off of dispose) off()
        disposeTimer()
      }
    })
  }
}
