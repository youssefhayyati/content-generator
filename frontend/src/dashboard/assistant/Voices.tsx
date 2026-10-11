import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, LoaderCircle, Mic, Play, Search, Square, Upload, X } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { Btn, inputClass, Skeleton, Select } from '../ui'
import { useAssistant, useVoiceState, type Voice } from './store'

const USE: Record<string, string> = {
  narration: 'Narration',
  conversational: 'Conversation',
  characters: 'Character',
  social: 'Social media',
  entertainment: 'Entertainment',
  advertisement: 'Advertising',
  informative: 'Explainer',
}

export function describe(v: Voice) {
  const bits = [v.description.charAt(0).toUpperCase() + v.description.slice(1)]
  if (v.cloned && !/clon/i.test(v.description)) bits.push('Cloned')
  if (v.use && USE[v.use]) bits.push(USE[v.use])
  if (v.language && v.language !== 'English') bits.push(v.language)
  return bits.filter(Boolean).join(' · ')
}

/**
 * Which voice the assistant speaks in, over the conversation panel: the voices ready to use, and the
 * voice server's catalog to find another (assistant/backend/voicestudio.py). Every sentence is said in
 * the one picked, and the pick is kept for the person, in all their conversations.
 */
export function VoicePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const a = useAssistant()
  const speaking = useVoiceState(a.link) === 'speaking'
  const [q, setQ] = useState('')
  const [lang, setLang] = useState('')
  const find = a.findVoices
  const online = a.conn === 'online'

  // Typing searches as you go, a moment after the last key
  useEffect(() => {
    if (!open || !online) return
    const t = window.setTimeout(() => find(q.trim(), lang), q.trim() ? 250 : 0)
    return () => window.clearTimeout(t)
  }, [open, online, q, lang, find])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const list = a.voices
  const searching = !!list && (list.q !== q.trim() || list.lang !== lang)
  const narrowed = !!(q.trim() || lang)
  // A catalog voice in use is a ready one with that catalog id
  const inUse = (v: Voice, catalog: boolean) => v.id === a.voice?.id || (catalog && v.id === a.voice?.archetype)
  const row = (v: Voice, i: number, catalog: boolean) => (
    <VoiceRow
      key={v.id}
      v={v}
      i={i}
      catalog={catalog}
      current={inUse(v, catalog)}
      speaking={speaking}
      onUse={() => a.chooseVoice(v, catalog)}
      pending={a.voicePending === v.id}
      busy={!!a.voicePending}
    />
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16, transition: { duration: 0.15 } }}
          transition={{ duration: 0.3, ease }}
          className="absolute inset-0 z-30 flex flex-col bg-panel"
          role="dialog"
          aria-label="Voice"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">Voice</p>
              <p className="truncate text-[11px] text-dim">
                Every sentence in this voice{a.kept ? ', in all your conversations' : ''}.
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close the voices" className="grid size-7 shrink-0 place-items-center rounded-md text-dim hover:bg-white/[0.05] hover:text-fg">
              <X className="size-4" />
            </button>
          </div>

          <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto p-3">
            {!list ? (
              <div className="space-y-1.5">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-[52px] rounded-lg" />
                ))}
              </div>
            ) : (
              <>
                <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-dim">Ready to use</p>
                <div className="space-y-1.5">{list.ready.map((v, i) => row(v, i, false))}</div>
                {list.clonable && <CloneVoice className="mt-2" onCloned={(v) => a.chooseVoice(v, false)} />}

                {list.choosable ? (
                  <>
                    <div className="mb-2 mt-5 flex items-center justify-between gap-2 px-1">
                      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">More voices</p>
                      <span className="flex items-center gap-1.5 font-mono text-[10px] text-dim">
                        {searching && <LoaderCircle className="size-3 animate-spin" />}
                        {list.total.toLocaleString()} {narrowed ? 'found' : 'featured'}
                      </span>
                    </div>
                    <div className="mb-2 flex gap-1.5">
                      <label className="relative block min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
                        <input
                          value={q}
                          onChange={(e) => setQ(e.target.value)}
                          placeholder="british, deep, calm…"
                          aria-label="Find a voice"
                          className={cn(inputClass, 'h-8 pl-8 text-[12.5px]')}
                        />
                      </label>
                      <div className="w-[8.75rem] shrink-0">
                        <Select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" fieldClassName={cn(inputClass, 'h-8 px-2 text-[12px]')}>
                          <option value="">Any language</option>
                          {list.languages.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <div className={cn('space-y-1.5 transition-opacity', searching && 'opacity-60')}>{list.catalog.map((v, i) => row(v, i, true))}</div>
                    {!list.catalog.length && <p className="px-1 pt-1 text-[11.5px] text-dim">No voice matches. Try fewer words, or another language.</p>}
                    {list.total > list.catalog.length && (
                      <p className="px-1 pt-2.5 text-[11.5px] leading-snug text-dim">
                        The first {list.catalog.length} of {list.total.toLocaleString()}. Add words to narrow it down: “male”, “young”, “narration”…
                      </p>
                    )}
                  </>
                ) : (
                  <p className="px-1 pt-3 text-[11.5px] leading-snug text-dim">
                    This assistant has its own voice{list.clonable ? ' and the ones cloned here' : ''}. Connected to a VoiceStudio server (TTS_URL), it can speak in any of over a thousand.
                  </p>
                )}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A voice to hear and pick: the conversation's voice (VoicePicker) or a video's (VideoMaker). */
export function VoiceRow({
  v,
  i,
  catalog,
  current,
  speaking,
  onUse,
  pending = false,
  busy = false,
  currentLabel = 'In use',
}: {
  v: Voice
  i: number
  catalog: boolean
  current: boolean
  speaking: boolean
  onUse: () => void
  pending?: boolean
  busy?: boolean
  currentLabel?: string
}) {
  const a = useAssistant()
  const mine = a.sample?.id === v.id
  const loading = mine && a.sample!.loading
  const playing = mine && !loading && speaking

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease, delay: Math.min(i, 8) * 0.02 }}
      className={cn('flex items-center gap-2.5 rounded-lg border py-2 pl-2 pr-2', current ? 'border-accent/40 bg-accent/[0.06]' : 'border-line hover:border-line-2')}
    >
      <button
        type="button"
        onClick={() => (playing ? a.interrupt() : a.previewVoice(v, catalog))}
        disabled={loading || a.conn !== 'online'}
        aria-label={playing ? 'Stop the sample' : `Hear ${v.name}`}
        title={playing ? 'Stop' : 'Hear it'}
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full border transition-colors disabled:opacity-60',
          playing ? 'border-accent-soft/60 text-accent-soft' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
        )}
      >
        {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : playing ? <Square className="size-3" fill="currentColor" /> : <Play className="size-3.5 translate-x-px" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium">{v.name}</p>
        {v.description && <p className="line-clamp-2 text-[11px] leading-snug text-muted">{describe(v)}</p>}
      </div>
      {current ? (
        <span className="flex shrink-0 items-center gap-1 px-1.5 font-mono text-[10px] text-accent-soft">
          <Check className="size-3" /> {currentLabel}
        </span>
      ) : (
        <Btn size="sm" onClick={onUse} loading={pending} disabled={busy || a.conn !== 'online'} className="shrink-0">
          Use
        </Btn>
      )}
    </motion.div>
  )
}

const MAX_TAKE = 20 // seconds: more doesn't make a closer clone

/**
 * A voice cloned from a recording (assistant/backend/session.py, clone_voice): one made here with the
 * mic, or a file of someone speaking (audio, or a video's sound). Five to twenty seconds of one person,
 * without music, makes the closest clone. It's one of the ready voices from then on, and onCloned picks it.
 * `clone` sends it elsewhere than the assistant's conversation (Creative Lab clones through the API).
 */
export function CloneVoice({ onCloned, className, clone: send }: { onCloned: (v: Voice) => void; className?: string; clone?: (recording: Blob, name: string) => Promise<Voice> }) {
  const a = useAssistant()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [take, setTake] = useState<{ blob: Blob; label: string; url: string } | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState<number | null>(null) // seconds so far
  const stopRecording = useRef<() => void>(() => {})
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => () => stopRecording.current(), [])
  useEffect(() => () => void (take && URL.revokeObjectURL(take.url)), [take])

  const keep = (blob: Blob, label: string) => {
    setError('')
    setTake({ blob, label, url: URL.createObjectURL(blob) })
  }

  const record = async () => {
    setError('')
    if (a.micOn) await a.toggleMic() // or the assistant would answer the sample
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      return setError('The microphone isn’t available. Allow it, or upload a file instead.')
    }
    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    const t0 = Date.now()
    const timer = window.setInterval(() => {
      const s = (Date.now() - t0) / 1000
      setRecording(s)
      if (s >= MAX_TAKE) rec.stop()
    }, 200)
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      window.clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      const seconds = Math.round((Date.now() - t0) / 1000)
      setRecording(null)
      if (seconds < 3) return setError('That was too short: talk for at least five seconds.')
      keep(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), `Your recording · ${seconds} s`)
    }
    stopRecording.current = () => rec.state !== 'inactive' && rec.stop()
    rec.start()
    setRecording(0)
  }

  const clone = async () => {
    if (!take) return
    setBusy(true)
    setError('')
    try {
      const v = await (send ?? a.cloneVoice)(take.blob, name.trim())
      onCloned(v)
      setOpen(false)
      setTake(null)
      setName('')
      setAgreed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!send && a.conn !== 'online'}
        className={cn('flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line-2 py-2 pl-2 pr-3 text-left transition-colors hover:border-white/30 disabled:opacity-60', className)}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-2 text-accent-soft">
          <Mic className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium">Clone a voice</span>
          <span className="block truncate text-[11px] text-muted">From a recording: yours, or someone’s who agreed.</span>
        </span>
      </button>
    )

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }} className={cn('space-y-2.5 rounded-lg border border-line-2 p-2.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium">Clone a voice</p>
        <button type="button" onClick={() => (stopRecording.current(), setOpen(false))} aria-label="Close" className="grid size-6 place-items-center rounded text-dim hover:bg-white/[0.05] hover:text-fg">
          <X className="size-3.5" />
        </button>
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it: My voice, Sarah…" aria-label="The voice’s name" maxLength={60} className={cn(inputClass, 'h-8 text-[12.5px]')} />

      {take ? (
        <div className="flex items-center gap-2">
          <audio src={take.url} controls className="h-8 min-w-0 flex-1" />
          <button type="button" onClick={() => setTake(null)} aria-label="Remove the recording" title="Another one" className="grid size-7 shrink-0 place-items-center rounded-md text-dim hover:bg-white/[0.05] hover:text-fg">
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          {recording != null ? (
            <Btn size="sm" icon={Square} onClick={() => stopRecording.current()} className="flex-1 border-fail/40 text-fail">
              Stop · {Math.floor(recording)} s of {MAX_TAKE}
            </Btn>
          ) : (
            <Btn size="sm" icon={Mic} onClick={() => void record()} className="flex-1">
              Record
            </Btn>
          )}
          <Btn size="sm" icon={Upload} onClick={() => fileInput.current?.click()} disabled={recording != null} className="flex-1">
            Upload a file
          </Btn>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) keep(f, f.name)
              if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 60))
            }}
          />
        </div>
      )}
      <p className="text-[11px] leading-snug text-dim">{take ? take.label : `5 to ${MAX_TAKE} seconds of one person talking, without music. A video works too: its sound is used.`}</p>

      <label className="flex items-start gap-2 text-[11.5px] leading-snug text-muted">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
        This is my voice, or the person agreed to have their voice cloned.
      </label>
      {error && <p className="text-[11.5px] leading-snug text-fail">{error}</p>}
      <Btn size="sm" variant="primary" onClick={() => void clone()} loading={busy} disabled={!take || !agreed || recording != null} className="w-full">
        {busy ? 'Cloning… about half a minute' : 'Clone it'}
      </Btn>
    </motion.div>
  )
}
