import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Clapperboard, Copy, Cpu, Ear, Film, Image as ImageIcon, LoaderCircle, Mic, Music2, PenLine, Repeat, RotateCcw, Shuffle, Type } from 'lucide-react'
import { api, type Asset, type Generation, type ModelInfo } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useApi } from '../data'
import { MediaThumb } from '../media/Media'
import { Player } from '../sound/Player'
import { Btn, inputClass } from '../ui'

export const KIND_ICON = { text: Type, image: ImageIcon, video: Clapperboard, voice: Mic, music: Music2, reel: Film, listen: Ear }

/** "Local · Ollama" or "Cloud · Claude API". */
export const reachLabel = (m: Pick<ModelInfo, 'local' | 'reach'>) => `${m.local ? 'Local' : 'Cloud'} · ${m.reach}`

/**
 * One list of local and cloud models. Each says how it's reached; the ones that can't run are
 * shown, greyed, with the reason.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  kind,
  className,
  align = 'left',
}: {
  models: ModelInfo[]
  value: string | null
  onChange: (id: string) => void
  kind?: ModelInfo['kind']
  className?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const list = models.filter((m) => !kind || m.kind === kind)
  const current = list.find((m) => m.id === value)

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const groups = Object.entries(
    list.reduce<Record<string, ModelInfo[]>>((acc, m) => ((acc[reachLabel(m)] ??= []).push(m), acc), {}),
  )

  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos(align === 'right' ? { top: r.bottom + 6, right: window.innerWidth - r.right } : { top: r.bottom + 6, left: r.left })
  }, [open, align])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-line-2 bg-white/[0.02] px-3 text-left text-[12.5px] transition-colors hover:border-white/20"
      >
        <Cpu className="size-3.5 shrink-0 text-dim" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{current?.label ?? (list.length ? 'Pick a model' : 'No models yet')}</span>
        {current && <span className="hidden shrink-0 rounded border border-line-2 px-1.5 py-px font-mono text-[9.5px] text-dim sm:inline">{reachLabel(current)}</span>}
        <ChevronDown className={cn('size-3.5 shrink-0 text-dim transition-transform', open && 'rotate-180')} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              role="listbox"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease }}
              data-lenis-prevent
              style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 130 }}
            className={cn(
              'max-h-[360px] w-[min(360px,90vw)] overflow-y-auto rounded-lg border border-line-2 bg-panel-3 p-1 shadow-[0_24px_60px_-20px_rgb(0_0_0_/_0.9)]',
            )}
          >
            {groups.map(([group, items]) => (
              <div key={group} className="py-1">
                <p className="px-2.5 pb-1 pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">{group}</p>
                {items.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={m.id === value}
                    disabled={!m.available}
                    onClick={() => {
                      onChange(m.id)
                      setOpen(false)
                    }}
                    className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn('flex items-center gap-2 text-[12.5px]', m.available ? 'text-fg' : 'text-dim')}>
                        <span className="truncate">{m.label}</span>
                        {m.score !== null && <span className="font-mono text-[9.5px] text-accent-soft">{m.score}</span>}
                      </span>
                      <span className={cn('mt-0.5 block text-[11px] leading-snug', m.available ? 'text-dim' : 'text-warn/80')}>
                        {m.available ? (m.purpose ?? m.model) : m.reason}
                      </span>
                    </span>
                    {m.id === value && <Check className="mt-0.5 size-3.5 shrink-0 text-accent-soft" strokeWidth={2} />}
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <p className="px-3 py-6 text-center text-[12px] text-dim">Nothing set up for this yet. See Models.</p>}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

/** Recent generations, refreshed every few seconds while any is still being made. */
export function useGenerations(query: Record<string, string | number | undefined>) {
  const result = useApi<Generation[]>('/generations', query)
  const busy = result.data?.some((g) => g.status === 'queued' || g.status === 'running')
  const { setData } = result
  const key = JSON.stringify(query)

  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => {
      api<Generation[]>('/generations', { query: JSON.parse(key) }).then(setData).catch(() => {})
    }, 3000)
    return () => window.clearInterval(t)
  }, [busy, key, setData])

  return result
}

function Elapsed({ from }: { from: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((now - Date.parse(from)) / 1000))
  return <>{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</>
}

const STATUS_STYLE: Record<Generation['status'], string> = {
  queued: 'text-dim',
  running: 'text-accent-soft',
  succeeded: 'text-ok',
  failed: 'text-fail',
  canceled: 'text-dim',
}

/**
 * A generation and what it made. If it failed: the error, and three ways forward — the same
 * again, another model, or an edited prompt.
 */
export function GenerationCard({
  generation: g,
  models,
  onRetry,
  actions,
  compact,
}: {
  generation: Generation
  models: ModelInfo[]
  onRetry: (g: Generation, change: { model?: string; prompt?: string }) => Promise<void>
  actions?: ReactNode
  compact?: boolean
}) {
  const [mode, setMode] = useState<null | 'model' | 'prompt'>(null)
  const [model, setModel] = useState(g.model)
  const [prompt, setPrompt] = useState(g.prompt)
  const [busy, setBusy] = useState(false)
  const Icon = KIND_ICON[g.kind]
  const working = g.status === 'queued' || g.status === 'running'

  const retry = async (change: { model?: string; prompt?: string }) => {
    setBusy(true)
    try {
      await onRetry(g, change)
      setMode(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      className={cn('overflow-hidden rounded-xl border bg-panel', g.status === 'failed' ? 'border-fail/30' : working ? 'border-accent/30' : 'border-line')}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3 text-[11.5px]">
        <Icon className="size-3.5 text-dim" strokeWidth={1.75} />
        <span className="truncate text-muted">{g.model_label}</span>
        {g.recipe && <span className="rounded border border-line-2 px-1.5 py-px font-mono text-[9.5px] text-dim">recipe · step {(g.recipe_step ?? 0) + 1}</span>}
        {g.retry_of && <Repeat className="size-3 text-dim" strokeWidth={2} aria-label="A retry" />}
        <span className={cn('ml-auto flex items-center gap-1.5 font-mono text-[10.5px]', STATUS_STYLE[g.status])}>
          {working && <LoaderCircle className="size-3 animate-spin" />}
          {working ? (
            <>
              {g.status === 'queued' ? 'Queued' : 'Making'} · <Elapsed from={g.started_at ?? g.created_at} />
            </>
          ) : g.status === 'succeeded' ? (
            'Done'
          ) : (
            'Failed'
          )}
        </span>
      </header>
      <p className={cn('px-3.5 pt-1.5 text-[12.5px] leading-snug text-dim', compact && 'line-clamp-2')}>{g.prompt}</p>

      <div className="p-3.5 pt-3">
        {working && g.kind !== 'text' && <div className={cn('skeleton rounded-lg', g.kind === 'voice' || g.kind === 'music' ? 'h-12 w-full' : g.kind === 'reel' ? 'mx-auto h-[300px] w-[169px]' : 'aspect-[4/3] w-full')} />}
        {g.kind === 'text' && g.output_text && <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-fg">{g.output_text}</p>}
        {g.outputs.length > 0 && (
          <div className={cn('grid gap-2', g.outputs.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
            {g.outputs.map((a) =>
              a.kind === 'audio' ? (
                <div key={a.id}>
                  <Player asset={a} compact={compact} />
                  <SoundFacts asset={a} />
                </div>
              ) : a.kind === 'video' ? (
                <video key={a.id} src={a.url} poster={a.poster_url ?? undefined} controls playsInline className={cn('w-full rounded-lg bg-black object-contain', g.kind === 'reel' ? 'mx-auto max-h-[520px] max-w-[300px]' : 'max-h-[440px]')} />
              ) : (
                <img key={a.id} src={a.url} alt={g.prompt} draggable={false} className="max-h-[440px] w-full rounded-lg bg-white/[0.03] object-contain" />
              ),
            )}
          </div>
        )}
        {g.inputs.length > 0 && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-dim">
            From
            {g.inputs.map((a) => (
              <MediaThumb key={a.id} asset={a} className="size-7" />
            ))}
          </div>
        )}

        {g.status === 'failed' && (
          <div className="mt-1 rounded-lg border border-fail/25 bg-fail/[0.06] p-3">
            <p className="text-[12.5px] leading-snug text-fg">{g.error}</p>
            {mode === null && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Btn size="sm" icon={RotateCcw} onClick={() => retry({})} loading={busy}>
                  Retry
                </Btn>
                {g.kind !== 'reel' && (
                  <Btn size="sm" icon={Shuffle} onClick={() => setMode('model')}>
                    Switch model
                  </Btn>
                )}
                <Btn size="sm" icon={PenLine} onClick={() => setMode('prompt')}>
                  Edit prompt
                </Btn>
              </div>
            )}
            {mode === 'model' && (
              <div className="mt-2.5 flex gap-2">
                <ModelPicker models={models} kind={g.kind === 'reel' ? undefined : g.kind} value={model} onChange={setModel} className="flex-1" />
                <Btn size="md" variant="primary" onClick={() => retry({ model })} loading={busy} disabled={model === g.model}>
                  Run
                </Btn>
              </div>
            )}
            {mode === 'prompt' && (
              <div className="mt-2.5 space-y-2">
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className={cn(inputClass, 'h-auto py-2')} />
                <div className="flex justify-end gap-1.5">
                  <Btn size="sm" variant="subtle" onClick={() => setMode(null)}>
                    Cancel
                  </Btn>
                  <Btn size="sm" variant="primary" onClick={() => retry({ prompt })} loading={busy} disabled={!prompt.trim() || prompt === g.prompt}>
                    Run again
                  </Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {(g.status === 'succeeded' || actions) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {g.kind === 'text' && g.output_text && (
              <Btn size="sm" variant="subtle" icon={Copy} onClick={() => navigator.clipboard?.writeText(g.output_text ?? '')}>
                Copy
              </Btn>
            )}
            {actions}
            {g.cost > 0 && <span className="ml-auto font-mono text-[10px] text-dim">${g.cost.toFixed(2)}</span>}
          </div>
        )}
      </div>
    </motion.article>
  )
}

/** What a sound is, in a line: whose voice and what language, or the track's mood, key and tempo. */
export function SoundFacts({ asset }: { asset: Asset }) {
  const s = asset.sound
  if (!s) return null
  const facts =
    s.type === 'voice'
      ? [s.voice_name, s.lang?.toUpperCase(), s.timed ? 'every word timed' : null]
      : s.type === 'music'
        ? [s.label, s.key, s.bpm ? `${Math.round(s.bpm)} bpm` : null, 'original, licence-free']
        : [s.transcript === 'done' ? 'transcribed' : null]
  const shown = facts.filter(Boolean)
  if (!shown.length) return null
  return <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{shown.join(' · ')}</p>
}
