/*
 * The voice assistant's WebSocket (assistant/backend/session.py, top of the file): microphone audio
 * up as PCM16 at 16 kHz, its voice down as PCM16 at 24 kHz behind a 4-byte turn id, everything
 * else as JSON events. The assistant runs as its own service; Vite (and nginx in production)
 * serve it under /assistant/ on this origin.
 */

export const ASSISTANT_BASE = '/assistant/'

/** A file the assistant serves (its pictures and drafts come as "media/…"). */
export const assistantUrl = (path: string) => (/^(https?:|data:|\/)/.test(path) ? path : ASSISTANT_BASE + path)

export type VoiceState = 'disconnected' | 'connected' | 'listening' | 'hearing' | 'thinking' | 'speaking'

export type AssistantEvent = { type: string } & Record<string, unknown>

const MAX_FILE = 10 * 1024 * 1024 // the WebSocket takes up to 16 MB a message; base64 adds a third

export class AssistantLink {
  private ws: WebSocket | null = null
  private audio: AudioContext | null = null
  private micNode: AudioWorkletNode | null = null
  private micStream: MediaStream | null = null
  private analyser: AnalyserNode | null = null
  private workletLoaded = false
  private ttsRate = 24000
  /** Audio from turns older than this is dropped: the user cut in. */
  private minTurn = 0
  private nextPlayTime = 0
  private sources: AudioBufferSourceNode[] = []
  private connecting: Promise<void> | null = null
  micOn = false
  userSpeaking = false
  thinking = false
  /** Off without headphones: the mic is muted while the assistant speaks, so it doesn't hear itself. */
  bargeIn = true

  constructor(
    private onEvent: (e: AssistantEvent) => void,
    private onClose: () => void,
  ) {}

  get open() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get playing() {
    return !!this.audio && this.audio.currentTime < this.nextPlayTime
  }

  get state(): VoiceState {
    if (!this.open) return 'disconnected'
    if (this.userSpeaking) return 'hearing'
    if (this.playing) return 'speaking'
    if (this.thinking) return 'thinking'
    return this.micOn ? 'listening' : 'connected'
  }

  connect(): Promise<void> {
    if (this.open) return Promise.resolve()
    this.connecting ??= new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}${ASSISTANT_BASE}ws`)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        this.ws = ws
        this.connecting = null
        resolve()
      }
      ws.onerror = () => {
        this.connecting = null
        reject(new Error('Can’t reach the assistant.'))
      }
      ws.onclose = () => {
        const was = this.ws === ws
        this.stopMic()
        this.stopPlayback()
        this.ws = null
        this.userSpeaking = this.thinking = false
        if (was) this.onClose()
      }
      ws.onmessage = (e) => (typeof e.data === 'string' ? this.event(JSON.parse(e.data)) : this.play(e.data))
    })
    return this.connecting
  }

  close() {
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.stopMic()
    this.stopPlayback()
  }

  send(msg: Record<string, unknown>) {
    if (this.open) this.ws!.send(JSON.stringify(msg))
  }

  /** Something typed instead of said. */
  async say(text: string) {
    this.ensureAudio()
    await this.connect()
    this.send({ type: 'text', text })
  }

  interrupt() {
    this.send({ type: 'interrupt' })
    this.stopPlayback()
  }

  private event(msg: AssistantEvent) {
    switch (msg.type) {
      case 'ready':
        this.ttsRate = Number(msg.tts_sample_rate) || 24000
        break
      case 'vad':
        this.userSpeaking = !!msg.speaking
        break
      case 'transcript':
        if (msg.final && msg.text) this.thinking = true
        break
      case 'assistant_delta':
      case 'assistant_done':
      case 'error':
        this.thinking = false
        break
      case 'interrupt':
        this.minTurn = Number(msg.turn)
        this.stopPlayback()
        this.thinking = false
        break
    }
    this.onEvent(msg)
  }

  /* -------------------------------- speech out -------------------------------- */

  /** Browsers only play sound after a click: call this from one. */
  ensureAudio() {
    this.audio ??= new AudioContext()
    if (this.audio.state === 'suspended') void this.audio.resume()
  }

  private play(buf: ArrayBuffer) {
    const turn = new DataView(buf).getUint32(0, true)
    if (turn < this.minTurn || !this.audio) return
    const pcm = new Int16Array(buf, 4)
    const clip = this.audio.createBuffer(1, pcm.length, this.ttsRate)
    const ch = clip.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768

    const src = this.audio.createBufferSource()
    src.buffer = clip
    src.connect(this.audio.destination)
    const start = Math.max(this.audio.currentTime + 0.03, this.nextPlayTime)
    src.start(start)
    this.nextPlayTime = start + clip.duration
    this.sources.push(src)
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src)
    }
  }

  stopPlayback() {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }
    this.sources = []
    this.nextPlayTime = 0
  }

  /* -------------------------------- microphone -------------------------------- */

  async startMic() {
    this.ensureAudio()
    await this.connect()
    const audio = this.audio!
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    if (!this.workletLoaded) {
      // The assistant serves the worklet that downsamples to what it listens to.
      await audio.audioWorklet.addModule(`${ASSISTANT_BASE}mic-worklet.js`)
      this.workletLoaded = true
    }
    const source = audio.createMediaStreamSource(this.micStream)
    this.micNode = new AudioWorkletNode(audio, 'mic-processor')
    this.analyser = audio.createAnalyser()
    this.analyser.fftSize = 512
    source.connect(this.analyser)
    source.connect(this.micNode)
    this.micNode.port.onmessage = (e) => {
      if (!this.open || (!this.bargeIn && this.playing)) return
      this.ws!.send(e.data)
    }
    this.micOn = true
  }

  stopMic() {
    this.micOn = false
    if (this.micNode) {
      this.micNode.port.onmessage = null
      this.micNode.disconnect()
      this.micNode = null
    }
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micStream = null
    this.analyser = null
    this.userSpeaking = false
  }

  /** How loud the mic is, 0 to 1. */
  level() {
    if (!this.analyser) return 0
    const data = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += v * v
    return Math.min(1, Math.sqrt(sum / data.length) * 6)
  }

  /* -------------------------------- attachments ------------------------------- */

  /** A picture, video or sound for the conversation, or a ComfyUI workflow (.json). */
  async upload(file: File) {
    this.ensureAudio()
    await this.connect()
    const name = file.name || 'pasted.png'
    if (name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
      let workflow: unknown
      try {
        workflow = JSON.parse(await file.text())
      } catch {
        throw new Error(`${name} isn’t valid JSON.`)
      }
      this.send({ type: 'upload', name, workflow })
      return
    }
    let data: string
    if (file.type.startsWith('image/') && file.type !== 'image/gif') data = await shrinkImage(file)
    else if (file.size > MAX_FILE) throw new Error(`${name} is too large (10 MB at most).`)
    else data = await readDataUrl(file)
    this.send({ type: 'upload', name, data })
  }
}

function readDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** Big photos go down to 2048 px on the long side, which is all a post uses. */
async function shrinkImage(file: File, max = 2048) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  if (scale === 1 && file.size <= MAX_FILE) {
    bmp.close()
    return readDataUrl(file)
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  let url = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92)
  if (url.length > MAX_FILE * 1.3) url = canvas.toDataURL('image/jpeg', 0.9)
  return url
}
