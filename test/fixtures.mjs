/**
 * 测试夹具：造一批假的 ~/.dsh/sessions 目录。
 *
 * 日志是 zstd 压缩的行 JSON，所以直接让每个事件 JSON.stringify 后 join('\n') 再压。
 * 记录形状必须和真实日志一致——尤其 user/message 的正文挂在 data.content，
 * assistant/message 的正文挂在 data.message.content（这里正是历史 bug 的来源）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

export function tempRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dse-' + tag + '-'))
}

export function userMessage(seq, text, kind = 'user') {
  return {
    type: 'user/message',
    seq,
    time: 1_700_000_000_000 + seq * 1000,
    data: {
      content: [{ type: 'text', text }],
      source: kind === '' ? {} : { kind },
      role: 'user',
      id: 'u' + seq,
    },
  }
}

export function assistantMessage(seq, text) {
  return {
    type: 'assistant/message',
    seq,
    time: 1_700_000_000_000 + seq * 1000,
    data: { message: { role: 'assistant', content: [{ type: 'text', text }] } },
  }
}

export function toolCall(seq, tool) {
  return { type: 'tool/call', seq, time: 1_700_000_000_000 + seq * 1000, data: { tool, args: { needle: 'should-not-be-indexed' } } }
}

export function sessionHeader(id, cwd, createdAt = 1_700_000_000_000) {
  return { type: 'session', version: 4, id, cwd, createdAt, delegationDepth: 0 }
}

export function sessionTitle(seq, title) {
  return { type: 'session/title', seq, time: 1_700_000_000_000 + seq * 1000, data: { title } }
}

/** 把事件写成一个会话文件：root/<encoded-cwd>/<sid>/session.v4.jsonl.zstd */
export function writeSession(root, cwdSlug, sid, events) {
  const dir = path.join(root, cwdSlug, sid)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  const text = events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(text, 'utf8')))
  return file
}

export function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true })
}
