// FlowAI phone bridge: a plugged-in phone's screen, live, in the Phones page — and the
// page's touches and keys sent straight back.
//
// The phone runs scrcpy's server (pushed on each session), which hardware-encodes the
// screen as H.264 and injects input in-process: no `screencap` PNGs, no `input` command
// starting a JVM per tap. This bridge reaches the phone through the adb server on the host
// (host.docker.internal:5037, as the API's scan does), relays the video to the browser over
// a WebSocket (the browser decodes it with WebCodecs) and turns the browser's JSON control
// messages into scrcpy's binary ones.
//
// Who may watch which phone is the API's call: it signs a one-minute ticket with APP_KEY
// (DeviceController::stream), and this bridge only checks the signature.
//
// No dependencies: node server.js.

import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:net'

const PORT = Number(process.env.PORT ?? 8004)
const ADB_HOST = process.env.ADB_SERVER_HOST ?? 'host.docker.internal'
const ADB_PORT = Number(process.env.ADB_SERVER_PORT ?? 5037)
// The server file and the version passed to it must match exactly.
const SCRCPY_VERSION = process.env.SCRCPY_VERSION ?? '4.1'
const REMOTE_JAR = '/data/local/tmp/flowai-scrcpy-server.jar'
const LARAVEL_ENV = process.env.LARAVEL_ENV_FILE ?? '/laravel/.env'
// A browser that can't keep up gets frames dropped (until the next key frame) rather than lag.
const MAX_BUFFERED = 1_500_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- tickets

function appKey() {
  if (process.env.APP_KEY) return process.env.APP_KEY
  try {
    const m = readFileSync(LARAVEL_ENV, 'utf8').match(/^APP_KEY=(.*)$/m)
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  } catch {
    return ''
  }
}

/** { d: device id, s: adb serial, c: may control, e: expiry (unix) }, or null. */
function verify(ticket) {
  const [body, sig] = String(ticket ?? '').split('.')
  const key = appKey()
  if (!body || !sig || !key) return null
  const want = Buffer.from(createHmac('sha256', key).update(body).digest('hex'))
  if (want.length !== sig.length || !timingSafeEqual(want, Buffer.from(sig))) return null
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString())
    return typeof t.s === 'string' && t.e >= Date.now() / 1000 ? t : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- adb

/** A socket read as a byte stream: read(n) resolves with exactly n bytes. */
class Pipe {
  constructor(socket) {
    this.socket = socket
    this.chunks = []
    this.size = 0
    this.ended = false
    this.discarding = false
    this.waiter = null
    socket.on('data', (c) => {
      if (this.discarding) return
      this.chunks.push(c)
      this.size += c.length
      this.wake()
    })
    socket.on('close', () => {
      this.ended = true
      this.wake()
    })
    socket.on('error', () => {})
  }

  wake() {
    const w = this.waiter
    this.waiter = null
    w?.()
  }

  async read(n) {
    while (this.size < n) {
      if (this.ended) throw new Error('the phone hung up')
      await new Promise((r) => (this.waiter = r))
    }
    let out
    if (this.chunks[0].length >= n) {
      out = this.chunks[0].subarray(0, n)
      this.chunks[0] = this.chunks[0].subarray(n)
      if (this.chunks[0].length === 0) this.chunks.shift()
    } else {
      const all = Buffer.concat(this.chunks)
      out = all.subarray(0, n)
      this.chunks = all.length > n ? [all.subarray(n)] : []
    }
    this.size -= n
    return out
  }

  /** Stop keeping what arrives (a log nobody reads, replies nobody needs). */
  discard() {
    this.discarding = true
    this.chunks = []
    this.size = 0
  }
}

// Same words as the API's Adb::explain(), so the page can tell "plug it in" from a real fault.
const NOT_CONNECTED = 'This phone isn’t connected to this computer. Plug it in by USB (or reconnect it over Wi-Fi).'

function explain(error) {
  if (/device '.*' not found|no devices/.test(error)) return NOT_CONNECTED
  if (error.includes('unauthorized')) return 'The phone is asking to allow USB debugging. Tap Allow on its screen.'
  if (error.includes('offline')) return 'The phone is connected but not answering. Unplug it and plug it back in.'
  return `adb: ${error}`
}

async function request(pipe, service) {
  pipe.socket.write(service.length.toString(16).padStart(4, '0') + service)
  const status = (await pipe.read(4)).toString()
  if (status !== 'OKAY') {
    const len = parseInt((await pipe.read(4)).toString(), 16)
    throw new Error(explain((await pipe.read(len)).toString()))
  }
}

/** A connection to an adb service, on one phone when `serial` is given. */
async function adb(service, serial) {
  const socket = connect(ADB_PORT, ADB_HOST)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', () => reject(new Error(`No adb server at ${ADB_HOST}:${ADB_PORT}. Start it on the machine the phone is plugged into: adb start-server.`)))
  })
  socket.setNoDelay(true)
  const pipe = new Pipe(socket)
  try {
    if (serial) await request(pipe, `host:transport:${serial}`)
    await request(pipe, service)
  } catch (e) {
    socket.destroy()
    throw e
  }
  return pipe
}

const le32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}

/** adb push, over the sync protocol. */
async function push(serial, data, path) {
  const p = await adb('sync:', serial)
  try {
    const target = Buffer.from(`${path},${0o644}`)
    const parts = [Buffer.from('SEND'), le32(target.length), target]
    for (let i = 0; i < data.length; i += 65536) {
      const chunk = data.subarray(i, i + 65536)
      parts.push(Buffer.from('DATA'), le32(chunk.length), chunk)
    }
    parts.push(Buffer.from('DONE'), le32(Math.floor(Date.now() / 1000)))
    p.socket.write(Buffer.concat(parts))
    const id = (await p.read(4)).toString()
    const len = (await p.read(4)).readUInt32LE()
    if (id !== 'OKAY') throw new Error(`Couldn't copy the screen server to the phone: ${(await p.read(len)).toString()}`)
  } finally {
    p.socket.destroy()
  }
}

let jar = null
async function serverJar() {
  if (jar) return jar
  const local = new URL(`./scrcpy-server-v${SCRCPY_VERSION}`, import.meta.url)
  if (existsSync(local)) return (jar = readFileSync(local))
  const url = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`No scrcpy server here, and downloading it failed (${res.status} from ${url}).`)
  return (jar = Buffer.from(await res.arrayBuffer()))
}

// ---------------------------------------------------------------- control messages

const int = (v, lo, hi) => Math.min(Math.max(Math.round(Number(v) || 0), lo), hi)

function keyEvent(action, code) {
  const b = Buffer.alloc(14) // type 0, action, keycode, repeat, meta state
  b[1] = action
  b.writeInt32BE(code, 2)
  return b
}

function position(b, at, m) {
  b.writeInt32BE(int(m.x, 0, 65535), at)
  b.writeInt32BE(int(m.y, 0, 65535), at + 4)
  b.writeUInt16BE(int(m.w, 1, 65535), at + 8)
  b.writeUInt16BE(int(m.h, 1, 65535), at + 10)
}

/** The browser's JSON as scrcpy's control message (scrcpy 4.1, app/src/control_msg.c). */
function encode(m) {
  switch (m?.t) {
    case 'touch': {
      const b = Buffer.alloc(32)
      b[0] = 2
      b[1] = int(m.action, 0, 2) // down, up, move
      b.writeBigInt64BE(-2n, 2) // a finger, not the mouse
      position(b, 10, m)
      b.writeUInt16BE(m.action === 1 ? 0 : 0xffff, 22) // pressure; action button and buttons stay 0
      return b
    }
    case 'key': {
      const code = int(m.code, 0, 400)
      return Buffer.concat([keyEvent(0, code), keyEvent(1, code)])
    }
    case 'text': {
      const text = String(m.text ?? '')
      if (/^[\x20-\x7e]{1,300}$/.test(text)) {
        const b = Buffer.alloc(5)
        b[0] = 1
        b.writeUInt32BE(text.length, 1)
        return Buffer.concat([b, Buffer.from(text)])
      }
      // Anything else (accents, emoji, long text) goes in through the clipboard, pasted.
      const data = Buffer.from(text.slice(0, 5000))
      const b = Buffer.alloc(14)
      b[0] = 9
      b[9] = 1 // paste
      b.writeUInt32BE(data.length, 10)
      return Buffer.concat([b, data])
    }
    case 'scroll': {
      const b = Buffer.alloc(21)
      b[0] = 3
      position(b, 1, m)
      const v = Math.max(-1, Math.min(1, (Number(m.v) || 0) / 16))
      b.writeInt16BE(Math.max(-0x8000, Math.min(0x7fff, Math.round(v * 0x8000))), 15)
      return b
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------- sessions

const sessions = new Map() // serial → Session: one viewer per phone

class Session {
  constructor(ticket, ws) {
    this.serial = ticket.s
    this.allowControl = ticket.c === true
    this.ws = ws
    this.pipes = []
    this.closed = false
    this.log = ''
    this.ctrl = null
    this.waitingForKey = false
  }

  async run() {
    sessions.get(this.serial)?.end('This phone was opened in another window.')
    sessions.set(this.serial, this)
    this.ws.onclose = () => this.end()
    this.ws.onmessage = (m) => this.control(m)
    try {
      await this.start()
      await this.pump()
    } catch (e) {
      const why = this.log.trim()
      this.end(this.closed ? undefined : why && !e.message.includes(why) ? `${e.message} (${why})` : e.message)
    }
  }

  async start() {
    await push(this.serial, await serverJar(), REMOTE_JAR)
    const scid = randomInt(0, 0x7fffffff).toString(16).padStart(8, '0')
    const args = [
      SCRCPY_VERSION,
      `scid=${scid}`,
      'log_level=warn',
      'tunnel_forward=true',
      'audio=false',
      'control=true',
      'video_codec=h264',
      'max_size=1280',
      'max_fps=60',
      'video_bit_rate=6000000',
      'send_device_meta=false',
      'send_frame_meta=true',
      'send_stream_meta=true',
      'send_dummy_byte=true',
      'clipboard_autosync=false',
      'power_on=true',
    ]
    // Closing this shell (when the viewer leaves) stops the server on the phone.
    const shell = this.track(await adb(`shell:CLASSPATH=${REMOTE_JAR} app_process / com.genymobile.scrcpy.Server ${args.join(' ')}`, this.serial))
    shell.discard()
    shell.socket.on('data', (c) => {
      this.log = (this.log + c.toString()).slice(-600)
      process.stdout.write(`[${this.serial}] ${c}`)
    })

    // The server accepts the video socket first, then control; only the first gets the dummy byte.
    this.video = this.track(await this.tunnel(scid, true))
    this.ctrl = this.track(await this.tunnel(scid, false))
    this.ctrl.discard() // device messages (clipboard) aren't used
    this.ws.text({ type: 'ready', control: this.allowControl })
  }

  async tunnel(scid, dummy) {
    const deadline = Date.now() + 8000
    for (;;) {
      if (this.closed) throw new Error('closed')
      let pipe = null
      try {
        pipe = await adb(`localabstract:scrcpy_${scid}`, this.serial)
        if (dummy) await pipe.read(1)
        return pipe
      } catch (e) {
        pipe?.socket.destroy()
        if (e.message.startsWith('No adb server') || e.message === NOT_CONNECTED) throw e
        if (Date.now() > deadline) throw new Error(`The phone's screen server didn't start. ${this.log.trim() || e.message}`)
        await sleep(120)
      }
    }
  }

  async pump() {
    const codec = (await this.video.read(4)).readUInt32BE()
    if (codec === 0 || codec === 1) throw new Error(`The phone refused to capture its screen. ${this.log.trim()}`)
    for (;;) {
      const head = await this.video.read(12)
      if (head[0] & 0x80) {
        // A new capture session (start, rotation): the video's size, which touches are measured in.
        this.ws.text({ type: 'size', width: head.readUInt32BE(4), height: head.readUInt32BE(8) })
        continue
      }
      const flags = head.readBigUInt64BE(0)
      const data = await this.video.read(head.readUInt32BE(8))
      const kind = flags & (1n << 62n) ? 0 : flags & (1n << 61n) ? 1 : 2 // config, key frame, frame

      if (kind === 2 && this.ws.socket.writableLength > MAX_BUFFERED) {
        if (!this.waitingForKey) this.ctrl?.socket.write(Buffer.from([17])) // reset video: a key frame soon
        this.waitingForKey = true
      }
      if (kind === 1) this.waitingForKey = false
      if (kind === 2 && this.waitingForKey) continue
      this.ws.binary(Buffer.from([kind]), data)
    }
  }

  control(raw) {
    if (!this.ctrl || this.closed) return
    let m
    try {
      m = JSON.parse(raw)
    } catch {
      return
    }
    // A browser that fell behind asks for a fresh key frame: harmless, so watchers may too.
    if (m?.t === 'reset') return void this.ctrl.socket.write(Buffer.from([17]))
    if (!this.allowControl) return
    const buf = encode(m)
    if (buf) this.ctrl.socket.write(buf)
  }

  track(pipe) {
    this.pipes.push(pipe)
    if (this.closed) pipe.socket.destroy()
    return pipe
  }

  end(message) {
    if (this.closed) return
    this.closed = true
    if (message) this.ws.text({ type: 'error', message, offline: message.startsWith(NOT_CONNECTED) })
    this.ws.close()
    for (const p of this.pipes) p.socket.destroy()
    if (sessions.get(this.serial) === this) sessions.delete(this.serial)
  }
}

// ---------------------------------------------------------------- a minimal WebSocket

class Ws {
  constructor(socket) {
    this.socket = socket
    this.buf = Buffer.alloc(0)
    this.open = true
    this.onmessage = () => {}
    this.onclose = () => {}
    socket.on('data', (c) => this.parse(c))
    socket.on('close', () => {
      this.open = false
      this.onclose()
    })
    socket.on('error', () => {})
  }

  parse(chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 2) {
      const op = this.buf[0] & 0x0f
      const masked = this.buf[1] & 0x80
      let len = this.buf[1] & 0x7f
      let at = 2
      if (len === 126) {
        if (this.buf.length < 4) return
        len = this.buf.readUInt16BE(2)
        at = 4
      } else if (len === 127) {
        if (this.buf.length < 10) return
        len = Number(this.buf.readBigUInt64BE(2))
        at = 10
      }
      if (len > 1 << 20) return this.socket.destroy()
      const mask = at
      if (masked) at += 4
      if (this.buf.length < at + len) return
      const data = Buffer.from(this.buf.subarray(at, at + len))
      if (masked) for (let i = 0; i < len; i++) data[i] ^= this.buf[mask + (i & 3)]
      this.buf = this.buf.subarray(at + len)

      if (op === 8) return this.close()
      if (op === 9) this.frame(10, [data])
      else if (op === 1) this.onmessage(data.toString())
    }
  }

  frame(op, parts) {
    if (!this.open) return
    const len = parts.reduce((n, p) => n + p.length, 0)
    let head
    if (len < 126) head = Buffer.from([0x80 | op, len])
    else if (len < 65536) head = Buffer.from([0x80 | op, 126, len >> 8, len & 0xff])
    else {
      head = Buffer.alloc(10)
      head[0] = 0x80 | op
      head[1] = 127
      head.writeBigUInt64BE(BigInt(len), 2)
    }
    this.socket.cork()
    this.socket.write(head)
    for (const p of parts) this.socket.write(p)
    this.socket.uncork()
  }

  text(obj) {
    this.frame(1, [Buffer.from(JSON.stringify(obj))])
  }

  binary(...parts) {
    this.frame(2, parts)
  }

  close() {
    if (!this.open) return
    this.frame(8, [])
    this.open = false
    this.socket.end()
  }
}

// ---------------------------------------------------------------- server

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://bridge').pathname.replace(/^\/phone-bridge/, '')
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, sessions: sessions.size }))
  }
  res.writeHead(404).end()
})

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://bridge')
  const ticket = verify(url.searchParams.get('ticket'))
  const key = req.headers['sec-websocket-key']
  if (url.pathname.replace(/^\/phone-bridge/, '') !== '/stream' || !key) return socket.destroy()
  if (!ticket) return socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')

  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  socket.setNoDelay(true)
  void new Session(ticket, new Ws(socket)).run()
})

server.listen(PORT, () => console.log(`phone bridge on :${PORT}, adb server at ${ADB_HOST}:${ADB_PORT}, scrcpy ${SCRCPY_VERSION}`))
