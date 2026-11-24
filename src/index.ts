/**
 * dsh-search-everything —— Host 半区。
 *
 * 职责：把 ~/.dsh/sessions 下的全部会话日志索引进内存，并通过一条 prefix 路由
 * 暴露给浏览器半区（不抢宿主 fallback，也不占用 /api 这个客户端连接专属命名空间）。
 * 每条请求先过宿主 connection.requestRejection 的准入判定（Host/Origin 围栏 + 浏览器
 * 会话 cookie），所以用户浏览器里别的网页调不到这些路由：
 *   GET /dsh-search-everything-api/refresh           打开搜索框时调一次，增量扫盘
 *   GET /dsh-search-everything-api/query?q=&limit=&role=&sid=&scope=
 *   GET /dsh-search-everything-api/sessions?limit=&scope=
 *   GET /dsh-search-everything-api/workspaces
 *   GET /dsh-search-everything-api/stats
 *
 * 索引策略（实测依据见 src/engine.ts 头注释）：
 *  - 启动后异步建库：有磁盘索引就直接恢复（~0.4s），没有才全量解压（15–17s）；
 *  - 之后不再后台轮询，面板打开时调一次 /refresh 增量重扫变化的文件；
 *  - 查询全程内存，20k 条消息 / 31MB 文本下全局单次 10–90ms，限定工作区 1–4ms。
 */
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SearchEngine } from './engine.ts'

export const name = 'dsh-search-everything'

export interface Config {
  /**
   * 后台定时巡检间隔（毫秒）；默认 0 = 关闭。
   * 默认走「按需刷新」：打开搜索框时前端调 /refresh 扫一次，平时完全不碰磁盘。
   */
  refreshIntervalMs?: number
  /**
   * 查询侧懒刷新阈值（毫秒）；默认 0 = 查询不触发刷新。
   * 设成正值时，距上次扫描超过该值的 query/sessions 会先增量扫一遍再回答。
   */
  lazyRefreshMs?: number
  /** 单次查询返回上限。 */
  maxResults?: number
  /** 会话根目录；默认 $DSH_HOME/sessions 或 ~/.dsh/sessions。 */
  sessionsRoot?: string
  /**
   * 磁盘索引目录；默认 $DSH_HOME/storages/dsh-search-everything。
   * 设成空串则关闭持久化（每次启动全量重扫），排查缓存问题时用。
   */
  cacheDir?: string
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

/**
 * 宿主 connection 服务的准入面（dsh-client-connection 的 HostConnectionService）。
 * 它把「这个请求能不能读用户私有数据」收敛成一次判断：Host/Origin 围栏挡住 DNS
 * rebinding 与跨站调用，浏览器会话 cookie 保证只有登录过的页面能进来。
 */
interface ConnectionLike {
  requestRejection(request: {
    headers: Record<string, string | string[] | undefined>
  }): 401 | 403 | undefined
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

export function isLoopback(address: string | undefined): boolean {
  if (address === undefined || address === '') return false
  return address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

export interface RouteRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}

export interface RouteResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/** 路由准入判定：undefined = 放行，401/403 = 拒绝用的状态码。 */
export type RouteReject = (req: RouteRequest) => 401 | 403 | undefined

/**
 * 给一条路由加准入闸门并返回 handler。
 *
 * 单独抽出来是为了能被测试直接驱动：verify 只需要一个假装成 req/res 的对象，
 * 不必起 HTTP 服务器，也不必加载整个 cordis 宿主。
 */
export function guarded(
  reject: RouteReject,
  handler: (req: any, res: any) => void | Promise<void>,
): (req: any, res: any) => Promise<void> {
  return async (req, res) => {
    const rejection = reject(req as RouteRequest)
    if (rejection !== undefined) {
      res.writeHead(rejection, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({ error: rejection === 401 ? 'unauthenticated' : 'rejected' }))
      return
    }
    await handler(req, res)
  }
}

/**
 * 把宿主 connection 服务包成准入判定；宿主没有这个服务时退回「只信回环地址」。
 *
 * 为什么不能只查回环：会话正文是用户私有数据，而本机端口对用户浏览器里打开的
 * 任何网页都是可达的（跨站请求、DNS rebinding）。connection.requestRejection
 * 是宿主自己的那把锁——Host/Origin 围栏加浏览器会话 cookie。
 */
/** 把 IncomingMessage.headers 拍平成普通对象（大小写不敏感地只保留字符串值）。 */
export function plainHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers === undefined || headers === null) return out
  for (const key of Object.keys(headers)) {
    const value = headers[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export function admissionOf(ctx: unknown): RouteReject {
  const get = (ctx as { get?: (name: string) => unknown } | undefined)?.get
  let connection: ConnectionLike | undefined
  if (typeof get === 'function') {
    try {
      const got = get.call(ctx, 'connection')
      if (got !== undefined && typeof (got as ConnectionLike).requestRejection === 'function') {
        connection = got as ConnectionLike
      }
    } catch {
      connection = undefined
    }
  }
  if (connection !== undefined) {
    return (req) => {
      try {
        // IncomingMessage.headers 是惰性解析的 getter 串，而且宿主围栏内部会再包一层
        // 不可枚举 header 视图；直接透传时读到的字段可能与实际请求不一致。
        // 这里先拍平成普通对象，围栏看到的就是浏览器真正发来的那几个头。
        return connection!.requestRejection({ headers: plainHeaders(req.headers) })
      } catch {
        // 判定本身出错时按不可信处理，绝不当作放行。
        return 403
      }
    }
  }
  return (req) => (isLoopback(req.socket?.remoteAddress) ? undefined : 403)
}


function writeJson(res: WebResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

function dshHome(): string {
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return home
  return path.join(os.homedir(), '.dsh')
}

function defaultSessionsRoot(): string {
  return path.join(dshHome(), 'sessions')
}

function defaultCacheDir(): string {
  return path.join(dshHome(), 'storages', 'dsh-search-everything')
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function apply(ctx: Context, config: Config = {}): void {
  const root = config.sessionsRoot ?? defaultSessionsRoot()
  const cacheDir = config.cacheDir ?? defaultCacheDir()
  const engine = new SearchEngine(root, cacheDir)
  const maxResults = clamp(config.maxResults ?? 50, 1, 200)
  const refreshIntervalMs = clamp(config.refreshIntervalMs ?? 0, 0, 600000)
  const lazyRefreshMs = clamp(config.lazyRefreshMs ?? 0, 0, 600000)

  // 首屏不等：先让插件激活成功，索引在后台自己跑完（有磁盘索引时是「恢复 + 增量校验」）。
  void engine.reindex().catch(() => {})

  let timer: any
  const disposeTimer = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  /**
   * 会话正文是用户私有数据，准入判定交给宿主自己那一套（connection.requestRejection）：
   * 只查回环地址挡不住「用户浏览器里打开的任意网页」对本机端口的跨站调用，
   * 也挡不住 DNS rebinding（Host 头是攻击者域名，socket 却打到本机）。
   */
  // 每条请求现取现判：apply 期取到的服务实例可能还没接到宿主连接上（实测过了准入
  // 判定恒为放行），而按请求解析总是拿到当前真正在用的那一个。
  const reject: RouteReject = (req) => admissionOf(ctx)(req)

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
      handler: guarded(reject, async (req, res) => {
        const r = req as unknown as WebRequest
        const out = res as unknown as WebResponse
        const url = new URL('http://localhost' + (r.url ?? '/'))
        const sub = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '')
        if (r.method !== 'GET' && r.method !== 'HEAD') {
          writeJson(out, 405, { error: 'method not allowed' })
          return
        }
        if (sub === 'refresh') {
          // 前端在打开搜索框时调用：扫一遍变化的会话文件，返回最新统计。
          const stats = await engine.refresh()
          writeJson(out, 200, { ok: true, stats })
          return
        }
        if (sub === 'query') {
          if (lazyRefreshMs > 0) await engine.ensureFresh(lazyRefreshMs)
          const q = url.searchParams.get('q') ?? ''
          const limit = clamp(Number(url.searchParams.get('limit') ?? '40') || 40, 1, maxResults)
          const role = url.searchParams.get('role') ?? ''
          const sid = url.searchParams.get('sid') ?? ''
          const titleOnly = url.searchParams.get('titleOnly') === '1'
          const scope = url.searchParams.get('scope') ?? ''
          const result = engine.search(q, limit, { role, sid, titleOnly, scope })
          writeJson(out, 200, { ok: true, query: q, ...result, stats: engine.stats() })
          return
        }
        if (sub === 'sessions') {
          if (lazyRefreshMs > 0) await engine.ensureFresh(lazyRefreshMs)
          const limit = clamp(Number(url.searchParams.get('limit') ?? '30') || 30, 1, 200)
          const scope = url.searchParams.get('scope') ?? ''
          writeJson(out, 200, { ok: true, sessions: engine.listSessions(limit, scope), stats: engine.stats() })
          return
        }
        if (sub === 'workspaces') {
          // 面板的「限定工作区」下拉：一次拿全，前端自己过滤，不必每次开面板都问。
          writeJson(out, 200, { ok: true, workspaces: engine.workspaces(), stats: engine.stats() })
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
        if (sub === 'flush') {
          // 卸载/退出前把内存索引落盘。平时靠 1.2s 防抖自动写，这条只是兜底。
          const wrote = engine.flush()
          writeJson(out, 200, { ok: true, wrote, stats: engine.stats() })
          return
        }
        if (sub === 'stats') {
          writeJson(out, 200, { ok: true, stats: engine.stats() })
          return
        }
        writeJson(out, 404, { error: 'not found' })
      }),
    }))

      return () => {
        for (const off of dispose) off()
        disposeTimer()
        // 插件被禁用或宿主退出：把最后一次增量写进磁盘索引，下次启动直接恢复。
        engine.flush()
      }
    })
  }
}