import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { api } from '../../lib/api'

/** What the page sends the phone bridge (phone-bridge/server.js turns it into scrcpy's messages). */
export type StreamControl =
  | { t: 'touch'; action: 0 | 1 | 2; x: number; y: number; w: number; h: number }
  | { t: 'scroll'; x: number; y: number; w: number; h: number; v: number }
  | { t: 'key'; code: number }
  | { t: 'text'; text: string }

export type PhoneStream = {
  /**
   * connecting → live. `offline`: the phone isn't plugged in; it keeps trying and goes live
   * when it is. `failed`: something else broke; use screenshots instead (reason in `error`).
   */
  status: 'connecting' | 'live' | 'offline' | 'failed'
  error: string | null
  control: boolean
  fps: number
  send: (m: StreamControl) => void
  retry: () => void
}

/**
 * The phone's screen as video: the bridge relays scrcpy's H.264, WebCodecs decodes it, each
 * frame is painted on `canvas` the moment it's ready (no buffering: lag is what this is for).
 * The canvas takes the video's size, which is also the space touches are measured in.
 */
export function usePhoneStream(deviceId: number, canvas: RefObject<HTMLCanvasElement | null>, enabled: boolean): PhoneStream {
  const [status, setStatus] = useState<PhoneStream['status']>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [control, setControl] = useState(false)
  const [fps, setFps] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const socket = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (typeof VideoDecoder === 'undefined') {
      setStatus('failed')
      setError('This browser can’t decode live video here (WebCodecs needs Chrome or Edge, on localhost or https).')
      return
    }

    let stopped = false
    let ws: WebSocket | null = null
    let config: Uint8Array | null = null
    let codec = ''
    let haveKey = false
    let timestamp = 0
    let frames = 0
    let again: number | undefined
    setStatus((s) => (s === 'offline' ? s : 'connecting'))

    const fail = (why: string, offline = false) => {
      if (stopped) return
      stopped = true
      setStatus(offline ? 'offline' : 'failed')
      setError(why)
      ws?.close()
      // Unplugged: look again every few seconds, and go live the moment it's back.
      if (offline) again = window.setTimeout(() => setAttempt((a) => a + 1), 3000)
    }

    const decoder = new VideoDecoder({
      output: (frame) => {
        const c = canvas.current
        if (c) {
          if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) {
            c.width = frame.displayWidth
            c.height = frame.displayHeight
          }
          c.getContext('2d')?.drawImage(frame, 0, 0)
        }
        frame.close()
        frames++
      },
      error: (e) => fail(`The video decoder stopped: ${e.message}`),
    })

    const meter = window.setInterval(() => {
      setFps(frames)
      frames = 0
    }, 1000)

    const packet = (bytes: Uint8Array) => {
      const kind = bytes[0]
      const data = bytes.subarray(1)
      if (kind === 0) {
        // Codec config (SPS/PPS): (re)configure, then wait for the key frame it belongs to.
        const next = avcCodec(data)
        if (next && (next !== codec || decoder.state !== 'configured')) {
          decoder.configure({ codec: next, optimizeForLatency: true })
          codec = next
        }
        config = data.slice()
        haveKey = false
        return
      }
      if (decoder.state !== 'configured' || (kind === 2 && !haveKey)) return
      let chunk = data
      if (kind === 1) {
        haveKey = true
        if (config) {
          chunk = concat(config, data)
          config = null
        }
      }
      // Too far behind: skip ahead to the next key frame rather than show old frames late.
      if (kind === 2 && decoder.decodeQueueSize > 6) {
        haveKey = false
        ws?.send(JSON.stringify({ t: 'reset' }))
        return
      }
      decoder.decode(new EncodedVideoChunk({ type: kind === 1 ? 'key' : 'delta', timestamp: (timestamp += 16_667), data: chunk }))
    }

    ;(async () => {
      try {
        const ticket = await api<{ url: string; control: boolean }>(`/devices/${deviceId}/stream`, { method: 'POST' })
        if (stopped) return
        setControl(ticket.control)
        ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${ticket.url}`)
        socket.current = ws
        ws.binaryType = 'arraybuffer'
        let opened = false
        ws.onmessage = (e) => {
          if (typeof e.data !== 'string') return packet(new Uint8Array(e.data as ArrayBuffer))
          const m = JSON.parse(e.data) as { type: string; message?: string; control?: boolean; offline?: boolean }
          if (m.type === 'ready') {
            opened = true
            setControl(!!m.control)
            setStatus('live')
            setError(null)
          } else if (m.type === 'error') fail(m.message ?? 'The stream stopped.', !!m.offline || opened)
        }
        // A stream that was live and stopped is most likely a cable pulled: treat it as unplugged.
        ws.onclose = () =>
          fail(opened ? 'The phone stopped sending its screen. Is it still plugged in?' : 'Can’t reach the phone bridge. Start it: docker compose up -d phone-bridge', opened)
      } catch (e) {
        fail(e instanceof Error ? e.message : 'Couldn’t open the stream.')
      }
    })()

    return () => {
      stopped = true
      window.clearInterval(meter)
      window.clearTimeout(again)
      ws?.close()
      socket.current = null
      if (decoder.state !== 'closed') decoder.close()
    }
  }, [deviceId, canvas, enabled, attempt])

  const send = useCallback((m: StreamControl) => {
    const ws = socket.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
  }, [])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])

  return { status, error, control, fps, send, retry }
}

/** The WebCodecs codec string, from the SPS in an Annex B config packet: avc1.PPCCLL. */
function avcCodec(data: Uint8Array): string | null {
  for (let i = 0; i + 4 < data.length; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue
    const start = data[i + 2] === 1 ? i + 3 : data[i + 2] === 0 && data[i + 3] === 1 ? i + 4 : -1
    if (start < 0 || start + 3 >= data.length) continue
    if ((data[start] & 0x1f) === 7) {
      return 'avc1.' + [data[start + 1], data[start + 2], data[start + 3]].map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  }
  return null
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}
