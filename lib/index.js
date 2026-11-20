/**
 * dsh-search-everything —— Host 半区。
 *
 * 职责：把 ~/.dsh/sessions 下的全部会话日志索引进内存，并通过一条 prefix 路由
 * 暴露给浏览器半区（不抢宿主 fallback，也不占用 /api 这个客户端连接专属命名空间）：
 *   GET /dsh-search-everything-api/refresh           打开搜索框时调一次，增量扫盘
 *   GET /dsh-search-everything-api/query?q=&limit=&role=&sid=&scope=
 *   GET /dsh-search-everything-api/sessions?limit=&scope=
 *   GET /dsh-search-everything-api/workspaces
 *   GET /dsh-search-everything-api/stats
 *
 * 索引策略（实测依据见 src/engine.ts 头注释）：
 *  - 启动后异步全量建库（每 6 个文件让一次事件循环），期间 /query 先回答空结果 + indexing 标记；
 *  - 之后每 5s 增量巡检一次 mtime/size，变了才重读那个文件；
 *  - 查询全程内存，实测 16k 条消息 / 28MB 文本下单次 8–45ms。
 */
import os from 'node:os'
import path from 'node:path'
                                                  
import { SearchEngine } from './engine.js'

export const name = 'dsh-search-everything'

                         
     
                            
                                               
     
                            
     
                                 
                                                
     
                        
                  
                     
                                                       
                       
     
                                                        
                                   
     
                   
 

                      
                 
              
                                                        
                                     
 

                       
                                                                   
                          
 

                         
                   
                            
                
                                                         
                
 

/**
 * 路由前缀。刻意不挂在 /api 下：/api 是 dsh-client-connection 独占的客户端连接命名空间，
 * 它把自己注册成 kind:"prefix" path:"/api"，任何走不到 peer 鉴权的请求都会被它 401 掉。
 */
export const API_PREFIX = '/dsh-search-everything-api'

function isLoopback(address                    )          {
  if (address === undefined || address === '') return false
  return address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

function writeJson(res             , status        , body         )       {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

function dshHome()         {
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return home
  return path.join(os.homedir(), '.dsh')
}

function defaultSessionsRoot()         {
  return path.join(dshHome(), 'sessions')
}

function defaultCacheDir()         {
  return path.join(dshHome(), 'storages', 'dsh-search-everything')
}

function clamp(value        , min        , max        )         {
  return Math.max(min, Math.min(max, value))
}

export function apply(ctx         , config         = {})       {
  const root = config.sessionsRoot ?? defaultSessionsRoot()
  const cacheDir = config.cacheDir ?? defaultCacheDir()
  const engine = new SearchEngine(root, cacheDir)
  const maxResults = clamp(config.maxResults ?? 50, 1, 200)
  const refreshIntervalMs = clamp(config.refreshIntervalMs ?? 0, 0, 600000)
  const lazyRefreshMs = clamp(config.lazyRefreshMs ?? 0, 0, 600000)

  // 首屏不等：先让插件激活成功，索引在后台自己跑完（有磁盘索引时是「恢复 + 增量校验」）。
  void engine.reindex().catch(() => {})

  let timer     
  const disposeTimer = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  const admit = (req            )          => {
    // 只服务本机回环：会话正文属于用户私有数据，宿主即便绑在局域网地址上也不外泄。
    const remote = req.socket?.remoteAddress
    return isLoopback(remote)
  }

  // 宿主半区取服务必须走 ctx.inject([...])：cordis 的 service 访问是被 trace 的，
  // 直接读 ctx.webServer 会抛 'cannot get property "webServer" without inject'，
  // 整个插件条目会被判为未激活（实测：dsh web 日志里 "1 entry did not activate"）。
  ctx.inject(['webServer'], (webCtx) => {
    const server = (webCtx                                            ).webServer
    if (server === undefined) return
    return run(server)
  })

  function run(server               ) {
    return ctx.effect(() => {
      if (refreshIntervalMs > 0) {
        timer = setInterval(() => {
          void engine.refresh().catch(() => {})
        }, refreshIntervalMs)
        timer.unref?.()
      }

      const dispose                    = []

      dispose.push(server.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        const r = req                         
        const out = res                          
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
      },
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