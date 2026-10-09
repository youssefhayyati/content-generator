import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Mic, Square } from 'lucide-react'
import { ApiError, uploadFiles } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useToast } from '../toast'

const MAX_SECONDS = 120

/**
 * Speak instead of typing. Press, talk, press again: the recording is transcribed on this
 * server and handed back as text. A live level shows it's listening. Where the browser won't
 * open the microphone (pages served without https), it opens the phone's recorder instead.
 */
export function Dictate({ onText, className, label = 'Dictate', iconOnly }: { onText: (text: string) => void; className?: string; label?: string; iconOnly?: boolean }) {
  const toast = useToast()
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const raf = useRef(0)
  const timer = useRef(0)
  const picker = useRef<HTMLInputElement>(null)

  const cleanup = () => {
    cancelAnimationFrame(raf.current)
    window.clearInterval(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setLevel(0)
  }
  useEffect(() => cleanup, [])

  const start = async () => {
    // Browsers only open the microphone on https. Elsewhere, the phone's own recorder (or a
    // file) does the same job: the file input below opens it.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      picker.current?.click()
      return
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      toast('No microphone: allow it for this site, then try again.', 'error')
      return
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t))
    const rec = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined)
    chunks.current = []
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    rec.onstop = send
    rec.start(250)
    recorder.current = rec
    setState('recording')
    setSeconds(0)

    // A level meter, so it's obvious the microphone hears you.
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream.current).connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
      setLevel(Math.min(1, peak / 64))
      raf.current = requestAnimationFrame(tick)
    }
    tick()
    const began = Date.now()
    timer.current = window.setInterval(() => {
      const s = Math.round((Date.now() - began) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS) stop()
    }, 250)
  }

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    cleanup()
  }

  async function send() {
    const blob = new Blob(chunks.current, { type: recorder.current?.mimeType || 'audio/webm' })
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
    await transcribe(new File([blob], `dictation.${ext}`, { type: blob.type }))
  }

  async function transcribe(file: File) {
    setState('working')
    try {
      const out = await uploadFiles<{ text: string }>('/sound/dictate', [file], undefined, 'audio')
      if (out.text.trim()) onText(out.text.trim())
      else toast('Didn’t catch any words. Try again, a little closer.', 'error')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t transcribe that.', 'error')
    } finally {
      setState('idle')
    }
  }

  return (
    <>
    <input
      ref={picker}
      type="file"
      accept="audio/*,video/*"
      capture="user"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) transcribe(file)
      }}
    />
    <button
      type="button"
      onClick={state === 'recording' ? stop : state === 'idle' ? start : undefined}
      disabled={state === 'working'}
      aria-label={state === 'recording' ? 'Stop and transcribe' : label}
      title={state === 'recording' ? 'Stop and transcribe' : label}
      className={cn(
        'relative inline-flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-full border px-2.5 text-[11.5px] transition-colors',
        state === 'recording' ? 'border-fail/50 bg-fail/10 text-fail' : 'border-line-2 text-muted hover:border-white/25 hover:text-fg',
        className,
      )}
    >
      {state === 'recording' && <span aria-hidden className="absolute inset-y-0 left-0 bg-fail/20 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />}
      <span className="relative flex items-center gap-1.5">
        {state === 'working' ? <LoaderCircle className="size-3.5 animate-spin" /> : state === 'recording' ? <Square className="size-3" fill="currentColor" /> : <Mic className="size-3.5" />}
        {state === 'recording' ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : state === 'working' ? (iconOnly ? '' : 'Listening…') : iconOnly ? '' : label}
      </span>
    </button>
    </>
  )
}
