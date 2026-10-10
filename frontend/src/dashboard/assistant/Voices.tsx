import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, LoaderCircle, Play, Search, Square, X } from 'lucide-react'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { Btn, inputClass, Skeleton } from '../ui'
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

function describe(v: Voice) {
  const bits = [v.description.charAt(0).toUpperCase() + v.description.slice(1)]
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
  const row = (v: Voice, i: number, catalog: boolean) => <VoiceRow key={v.id} v={v} i={i} catalog={catalog} current={inUse(v, catalog)} speaking={speaking} />

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
                        <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" className={cn(inputClass, 'h-8 px-2 text-[12px]')}>
                          <option value="">Any language</option>
                          {list.languages.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
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
                    This assistant has the one voice made on its computer. Connected to a VoiceStudio server (TTS_URL), it can speak in any of over a thousand.
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

function VoiceRow({ v, i, catalog, current, speaking }: { v: Voice; i: number; catalog: boolean; current: boolean; speaking: boolean }) {
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
          <Check className="size-3" /> In use
        </span>
      ) : (
        <Btn size="sm" onClick={() => a.chooseVoice(v, catalog)} loading={a.voicePending === v.id} disabled={!!a.voicePending || a.conn !== 'online'} className="shrink-0">
          Use
        </Btn>
      )}
    </motion.div>
  )
}
