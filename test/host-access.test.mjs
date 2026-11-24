/**
 * 路由准入回归测试。跑法：node --test test/
 *
 * 起因是一次真实的评审意见：插件把会话正文（用户私有数据）开在宿主端口上，
 * 只查了「请求来自回环地址」。这挡不住用户浏览器里任意网页的跨站调用，也挡不住
 * DNS rebinding。准入判定必须走宿主的 connection.requestRejection。
 *
 * 覆盖 6 种情形：闸门放行/拒绝，以及三种准入来源（connection 拒绝、connection 放行、
 * 宿主没有 connection 时退回回环检查）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { admissionOf, guarded, isLoopback } from '../lib/index.js'

function fakeRes() {
  const out = { status: 0, headers: {}, body: '' }
  return {
    out,
    writeHead(status, headers) { out.status = status; out.headers = headers ?? {} },
    end(body) { out.body = String(body ?? '') },
  }
}

const reqWith = (address, headers = {}) => ({ method: 'GET', url: '/x', headers, socket: { remoteAddress: address } })

test('闸门：准入拒绝时不进入 handler', async () => {
  let called = false
  const res = fakeRes()
  await guarded(() => 401, () => { called = true })(reqWith('127.0.0.1'), res)
  assert.equal(called, false)
  assert.equal(res.out.status, 401)
  assert.deepEqual(JSON.parse(res.out.body), { error: 'unauthenticated' })
  assert.equal(res.out.headers['cache-control'], 'no-store')
})

test('闸门：403 的响应体与 401 区分开', async () => {
  const res = fakeRes()
  await guarded(() => 403, () => {})(reqWith('127.0.0.1'), res)
  assert.equal(res.out.status, 403)
  assert.deepEqual(JSON.parse(res.out.body), { error: 'rejected' })
})

test('闸门：准入放行时 handler 照常执行', async () => {
  let seen = ''
  const res = fakeRes()
  await guarded(() => undefined, (req, r) => { seen = req.url; r.writeHead(200); r.end('ok') })(reqWith('10.0.0.5'), res)
  assert.equal(seen, '/x')
  assert.equal(res.out.status, 200)
  assert.equal(res.out.body, 'ok')
})

test('准入：宿主 connection 的拒绝优先于回环地址', () => {
  const ctx = { get: (name) => (name === 'connection' ? { requestRejection: () => 403 } : undefined) }
  assert.equal(admissionOf(ctx)(reqWith('127.0.0.1')), 403)
})

test('准入：connection 判定抛错时按不可信处理', () => {
  const ctx = { get: () => ({ requestRejection: () => { throw new Error('boom') } }) }
  assert.equal(admissionOf(ctx)(reqWith('127.0.0.1')), 403)
})

test('准入：没有 connection 服务时退回回环检查', () => {
  const noService = admissionOf({ get: () => undefined })
  assert.equal(noService(reqWith('127.0.0.1')), undefined)
  assert.equal(noService(reqWith('::1')), undefined)
  assert.equal(noService(reqWith('::ffff:127.0.0.1')), undefined)
  assert.equal(noService(reqWith('192.168.1.20')), 403)
  assert.equal(noService(reqWith(undefined)), 403)
  // ctx.get 本身不可用时（更老的宿主）不能抛。
  assert.equal(admissionOf({})(reqWith('127.0.0.1')), undefined)
})

test('准入：把请求头原样交给宿主判定', () => {
  const seen = []
  const ctx = { get: () => ({ requestRejection: (r) => { seen.push(r.headers.host); return undefined } }) }
  admissionOf(ctx)(reqWith('127.0.0.1', { host: 'evil.example' }))
  assert.deepEqual(seen, ['evil.example'])
})

test('isLoopback 只认本机字面量', () => {
  for (const ok of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(ok), true, ok)
  for (const no of ['', undefined, '10.0.0.1', '::ffff:10.0.0.1', 'localhost']) assert.equal(isLoopback(no), false, String(no))
})
