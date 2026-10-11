import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, LoaderCircle, Mic2, Play, Search, Square } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { CloneVoice, describe } from '../assistant/Voices'
import type { Voice } from '../assistant/store'
import { Btn, inputClass, Skeleton } from '../ui'

type List = { ready: Voice[]; catalog: Voice[]; total: number; languages: string[]; choosable: boolean; clonable: boolean }

const sampleUrl = (v: Voice, catalog: boolean) => `/api/lab/voices/sample?id=${encodeURIComponent(v.id)}&catalog=${catalog ? 1 : 0}`

/**
 * A node's voice, picked like the assistant's own: the ready voices (made, cloned, or set up from the
 * catalog), the catalog of over a thousand searched by words and language, each one heard before it's
 * used, and a voice cloned from a recording. `prefix` is how the node names a voice (vs: for a
 * Voiceover); empty means the node's own default (`emptyLabel`).
 */
export function LabVoicePicker({ id, value, onChange, prefix = '', emptyLabel }: { id: string; value: string; onChange: (v: string | null) => void; prefix?: string; emptyLabel: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [lang, setLang] = useState('')
  const [list, setList] = useState<List | null>(null)
  const [known, setKnown] = useState<Voice[]>([])
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const [using, setUsing] = useState<string | null>(null)
  const [playing, setPlaying] = useState<{ id: string; loading: boolean } | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  // Searches can answer out of order: only the latest one's list is shown.
  const asked = useRef(0)
  const load = (words = q, language = lang) => {
    const n = ++asked.current
    return api<List>('/lab/voices/list', { query: { q: words.trim(), lang: language } })
      .then((l) => {
        if (!words.trim()) setKnown(l.ready)
        if (n !== asked.current) return
        setList(l)
        setError('')
      })
      .catch((e) => n === asked.current && setError(e instanceof ApiError ? e.message : 'The voices couldn’t be listed.'))
      .finally(() => n === asked.current && setSearching(false))
  }

  // The ready voices once, to name the one picked; the catalog as you type, a moment after the last key.
  useEffect(() => {
    void load('', '')
  }, [])
  useEffect(() => {
    if (!open) return
    setSearching(true)
    const t = window.setTimeout(() => void load(), q.trim() ? 300 : 0)
    return () => window.clearTimeout(t)
  }, [open, q, lang])
  useEffect(() => () => audio.current?.pause(), [])

  const current = known.find((v) => prefix + v.id === value) ?? list?.ready.find((v) => prefix + v.id === value)

  const hear = (v: Voice, catalog: boolean) => {
    audio.current?.pause()
    if (playing?.id === v.id) return setPlaying(null)
    const el = new Audio(sampleUrl(v, catalog))
    audio.current = el
    setPlaying({ id: v.id, loading: true })
    el.oncanplay = () => setPlaying((p) => (p?.id === v.id ? { id: v.id, loading: false } : p))
    el.onended = () => setPlaying((p) => (p?.id === v.id ? null : p))
    el.onerror = () => {
      setPlaying(null)
      setError('That voice couldn’t be played. Is the pod up?')
    }
    void el.play().catch(() => setPlaying(null))
  }

  const use = async (v: Voice, catalog: boolean) => {
    if (!catalog) {
      onChange(prefix + v.id)
      setOpen(false)
      return
    }
    // A catalog voice is set up as a ready one first (about three seconds).
    setUsing(v.id)
    try {
      const r = await api<{ voice: Voice }>('/lab/voices/use', { method: 'POST', body: { id: v.id } })
      setKnown((k) => [...k.filter((x) => x.id !== r.voice.id), r.voice])
      onChange(prefix + r.voice.id)
      setOpen(false)
      void load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That voice couldn’t be set up.')
    } finally {
      setUsing(null)
    }
  }

  const clone = async (recording: Blob, name: string) => {
    const form = new FormData()
    const ext = recording.type.includes('mp4') ? 'mp4' : recording.type.includes('ogg') ? 'ogg' : recording.type.includes('wav') ? 'wav' : recording.type.includes('mpeg') ? 'mp3' : 'webm'
    form.append('recording', recording, recording instanceof File ? recording.name : `recording.${ext}`)
    form.append('name', name)
    form.append('consent', '1')
    try {
      const r = await api<{ voice: Voice }>('/lab/voices/clone', { method: 'POST', body: form })
      setKnown((k) => [...k, r.voice])
      void load()
      return r.voice
    } catch (e) {
      throw new Error(e instanceof ApiError ? (Object.values(e.errors ?? {})[0]?.[0] ?? e.message) : 'The voice couldn’t be cloned.')
    }
  }

  const row = (v: Voice, i: number, catalog: boolean) => {
    const chosen = !catalog && prefix + v.id === value
    const mine = playing?.id === v.id
    return (
      <motion.div
        key={(catalog ? 'c-' : 'r-') + v.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease, delay: Math.min(i, 8) * 0.02 }}
        className={cn('flex items-center gap-2.5 rounded-lg border py-2 pl-2 pr-2', chosen ? 'border-accent/40 bg-accent/[0.06]' : 'border-line hover:border-line-2')}
      >
        <PlayButton v={v} playing={mine && !playing?.loading} loading={mine && !!playing?.loading} onClick={() => hear(v, catalog)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium">{v.name}</p>
          {(v.description || v.cloned) && <p className="line-clamp-2 text-[11px] leading-snug text-muted">{describe({ ...v, description: v.description || '' }) || 'Cloned from a recording'}</p>}
        </div>
        {chosen ? (
          <span className="flex shrink-0 items-center gap-1 px-1.5 font-mono text-[10px] text-accent-soft">
            <Check className="size-3" /> Chosen
          </span>
        ) : (
          <Btn size="sm" onClick={() => void use(v, catalog)} loading={using === v.id} disabled={!!using} className="shrink-0">
            Use
          </Btn>
        )}
      </motion.div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2.5 rounded-lg border border-line py-2 pl-2 pr-2">
        {current ? (
          <PlayButton v={current} playing={playing?.id === current.id && !playing.loading} loading={playing?.id === current.id && !!playing?.loading} onClick={() => hear(current, false)} />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-2 text-accent-soft">
            <Mic2 className="size-3.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium">{current ? current.name : value ? `Voice ${value.replace(prefix, '')}` : emptyLabel}</p>
          {current && <p className="line-clamp-2 text-[11px] leading-snug text-muted">{describe({ ...current, description: current.description || '' }) || 'Cloned from a recording'}</p>}
        </div>
        <Btn id={id} size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="shrink-0">
          {open ? 'Close' : value ? 'Change' : 'Choose'}
        </Btn>
      </div>

      {/* Cloning is always one click away, like in the assistant's voice picker. */}
      {list?.clonable !== false && <CloneVoice className="mt-1.5" clone={clone} onCloned={(v) => void use(v, false)} />}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
            <div className="space-y-3 pt-2">
              {list?.choosable !== false && (
                <div className="space-y-1.5">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Describe it: warm, british, narration…" aria-label="Find a voice" className={cn(inputClass, 'h-8 pl-8 text-[12.5px]')} />
                  </label>
                  <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" className={cn(inputClass, 'h-8 px-2 text-[12px]')}>
                    <option value="">Any language</option>
                    {(list?.languages ?? []).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {error && <p className="text-[11.5px] leading-snug text-warn">{error}</p>}
              {!list ? (
                <div className="space-y-1.5">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-[52px] rounded-lg" />
                  ))}
                </div>
              ) : (
                <div data-lenis-prevent data-scroll className={cn('max-h-[22rem] space-y-3 overflow-y-auto pr-0.5 transition-opacity', searching && 'opacity-60')}>
                  {value && (
                    <button type="button" onClick={() => (onChange(null), setOpen(false))} className="px-1 text-[11.5px] text-muted underline decoration-white/25 underline-offset-2 hover:text-fg">
                      Use {emptyLabel.charAt(0).toLowerCase() + emptyLabel.slice(1)} instead
                    </button>
                  )}
                  {!!list.ready.length && (
                    <div>
                      <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-dim">Your voices</p>
                      <div className="space-y-1.5">{list.ready.map((v, i) => row(v, i, false))}</div>
                    </div>
                  )}
                  {list.choosable && (
                    <div>
                      <p className="mb-1.5 flex items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
                        More voices
                        <span className="flex items-center gap-1.5 normal-case tracking-normal">
                          {searching && <LoaderCircle className="size-3 animate-spin" />}
                          {list.total.toLocaleString()} {q.trim() || lang ? 'found' : 'featured'}
                        </span>
                      </p>
                      <div className="space-y-1.5">{list.catalog.map((v, i) => row(v, i, true))}</div>
                      {!list.catalog.length && <p className="px-1 text-[11.5px] text-dim">No voice matches. Try fewer words, or another language.</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PlayButton({ v, playing, loading, onClick }: { v: Voice; playing: boolean; loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={playing ? 'Stop the sample' : `Hear ${v.name}`}
      title={playing ? 'Stop' : 'Hear it'}
      className={cn('grid size-8 shrink-0 place-items-center rounded-full border transition-colors', playing ? 'border-accent-soft/60 text-accent-soft' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg')}
    >
      {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : playing ? <Square className="size-3" fill="currentColor" /> : <Play className="size-3.5 translate-x-px" fill="currentColor" />}
    </button>
  )
}
