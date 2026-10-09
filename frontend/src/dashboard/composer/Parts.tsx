import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Bot, Check, CircleAlert, ImagePlus, LoaderCircle, RotateCcw, Sparkles, TriangleAlert, X } from 'lucide-react'
import { PLATFORMS, PlatformIcon, type PlatformId } from '../../components/ui/PlatformIcon'
import { api, ApiError, type Account, type Asset, type Generation, type Registry, type SpecCheck } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { CHAR_LIMIT, PLATFORM_ORDER, useApi, useDebounced } from '../data'
import { MediaPicker, MediaThumb } from '../media/Media'
import { FieldError, Label, Panel } from '../ui'

type Specs = Record<PlatformId, Record<string, { label: string }>>

/**
 * Where the post goes, decided before it's written, since the writer, the counter and the
 * preview all depend on it: one of your accounts (its platform, its phone), or platforms picked
 * by hand. Picked platforms show their name and the characters left; the rest wait as icons,
 * so the whole choice fits in a row or two.
 */
export function Destination({
  accounts,
  accountId,
  onAccount,
  platforms,
  onToggle,
  length,
  error,
}: {
  accounts: Account[]
  accountId: number | null
  onAccount: (a: Account | null) => void
  platforms: PlatformId[]
  onToggle: (id: PlatformId) => void
  /** The caption's length, for each picked platform's characters left. */
  length: number
  error?: string
}) {
  const account = accounts.find((a) => a.id === accountId) ?? null
  return (
    <div className="border-b border-line px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <Label>Post to</Label>
        <span className="font-mono text-[10px] text-dim">
          {account ? (account.automation ? 'Its phone publishes it' : PLATFORMS[account.platform].name) : `${platforms.length} selected`}
        </span>
      </div>
      {accounts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip on={!account} onClick={() => onAccount(null)}>
            Pick platforms
          </Chip>
          {accounts.map((a) => (
            <Chip key={a.id} on={a.id === accountId} onClick={() => onAccount(a)}>
              <PlatformIcon id={a.platform} className="size-3.5" />@{a.handle}
              {a.automation && <Bot className={cn('size-3', a.id === accountId ? 'text-ink/60' : 'text-accent-soft')} strokeWidth={2} aria-label="Publishes automatically" />}
            </Chip>
          ))}
        </div>
      )}
      {!account && (
        <div className={cn('flex flex-wrap items-center gap-1.5', accounts.length ? 'mt-2' : 'mt-3')}>
          {PLATFORM_ORDER.map((id) => (
            <PlatformToggle key={id} id={id} on={platforms.includes(id)} left={CHAR_LIMIT[id] - length} onClick={() => onToggle(id)} />
          ))}
        </div>
      )}
      <FieldError message={error} />
    </div>
  )
}

/** A platform as an icon; picked, it opens to its name and the characters left. */
function PlatformToggle({ id, on, left, onClick }: { id: PlatformId; on: boolean; left: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={PLATFORMS[id].name}
      title={on ? undefined : PLATFORMS[id].name}
      onClick={onClick}
      className={cn(
        'flex h-8 items-center rounded-full border px-2 text-[12px] transition-[background-color,border-color,color] duration-300',
        on ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
      )}
    >
      <PlatformIcon id={id} className="size-3.5 shrink-0" />
      <AnimatePresence initial={false}>
        {on && (
          <motion.span
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease }}
            className="flex items-center gap-2 overflow-hidden whitespace-nowrap"
          >
            <span className="pl-1.5">{PLATFORMS[id].name}</span>
            {left <= 9999 && <span className={cn('pr-1 font-mono text-[10px]', left < 0 ? 'text-fail' : 'text-ink/50')}>{left < 0 ? `${-left} over` : left}</span>}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] transition-[background-color,border-color,color] duration-300',
        on ? 'border-fg bg-fg text-ink' : 'border-line-2 text-muted hover:border-white/30 hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

/** The post's media, in order: add from the library, generate with AI, reorder, remove. */
export function MediaStrip({
  media,
  onChange,
  max = 10,
  generate,
}: {
  media: Asset[]
  onChange: (media: Asset[]) => void
  max?: number
  /** When the post format has AI-made media: what kind, and what the post is about. */
  generate?: { kind: 'image' | 'video'; hint: string }
}) {
  const [picking, setPicking] = useState(false)
  const move = (i: number, by: number) => {
    const next = [...media]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    onChange(next)
  }

  return (
    <div className="border-t border-line px-5 py-4">
      <div className="flex items-center justify-between">
        <Label>Media</Label>
        {media.length > 0 && <span className="font-mono text-[10px] text-dim">{media.length} {media.length === 1 ? 'file' : 'files'}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <AnimatePresence initial={false}>
          {media.map((a, i) => (
            <motion.div
              key={a.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3, ease }}
              className="group relative w-[88px]"
            >
              <MediaThumb asset={a} />
              <span className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <IconBtn label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)} icon={ArrowLeft} />
                <IconBtn label="Move later" disabled={i === media.length - 1} onClick={() => move(i, 1)} icon={ArrowRight} />
              </span>
              <span className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <IconBtn label="Remove" onClick={() => onChange(media.filter((m) => m.id !== a.id))} icon={X} />
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {media.length < max && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            aria-label="Add media"
            className="grid aspect-square w-[88px] place-items-center rounded-md border border-dashed border-line-2 text-dim transition-colors hover:border-accent-soft/60 hover:text-fg"
          >
            <span className="flex flex-col items-center gap-1 text-[11px]">
              <ImagePlus className="size-4" strokeWidth={1.75} />
              Add
            </span>
          </button>
        )}
      </div>
      {generate && media.length < max && (
        <GenerateMedia kind={generate.kind} hint={generate.hint} onMade={(assets) => onChange([...media, ...assets].slice(0, max))} />
      )}
      <MediaPicker open={picking} onClose={() => setPicking(false)} onPick={onChange} initial={media} max={max} />
    </div>
  )
}

/**
 * Make the media right here: a prompt seeded from the post, a model that can do it, and the
 * result lands in the strip. Honestly says when no model for the kind is set up.
 */
function GenerateMedia({ kind, hint, onMade }: { kind: 'image' | 'video'; hint: string; onMade: (assets: Asset[]) => void }) {
  const { data: registry } = useApi<Registry>('/models')
  const usable = (registry?.models ?? []).filter((m) => m.kind === kind && m.available)
  const [prompt, setPrompt] = useState(hint)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<Generation | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The prompt follows the post until the person makes it their own.
  useEffect(() => {
    if (!dirty) setPrompt(hint)
  }, [hint, dirty])

  // The prompt grows to show all of itself (up to five lines) instead of hiding its second line.
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    // `registry` too: the field only mounts once the models have loaded.
  }, [prompt, registry])

  // Poll while the generation runs; the outputs join the strip when it lands.
  useEffect(() => {
    if (!busy || busy.status === 'succeeded' || busy.status === 'failed' || busy.status === 'canceled') return
    const t = setInterval(async () => {
      try {
        const g = await api<Generation>(`/generations/${busy.id}`)
        setBusy(g)
        if (g.status === 'succeeded') {
          if (g.outputs.length) onMade(g.outputs)
          setBusy(null)
        } else if (g.status !== 'queued' && g.status !== 'running') {
          setError(g.error ?? 'It didn’t work. Try again.')
          setBusy(null)
        }
      } catch {
        /* a lost poll isn't fatal; the next one tries again */
      }
    }, 2000)
    return () => clearInterval(t)
  }, [busy, onMade])

  if (!registry || !usable.length) {
    return registry ? (
      <p className="mt-3 text-[11.5px] leading-snug text-dim">
        No {kind} model is set up yet. Connect one on the <a href="/dashboard/models" className="text-accent-soft hover:underline">Models</a> page and this post can make its own {kind} here.
      </p>
    ) : null
  }

  const run = async () => {
    if (!prompt.trim() || busy) return
    setError(null)
    try {
      const g = await api<Generation>('/generations', { method: 'POST', body: { kind, prompt: prompt.trim(), model: usable[0].id } })
      if (g.status === 'failed') setError(g.error ?? 'It didn’t work. Try again.')
      else setBusy(g)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The generation didn’t start. Try again.')
    }
  }

  return (
    <div className="mt-3">
      <div
        className={cn(
          'flex flex-wrap items-end gap-2 rounded-lg border border-line-2 bg-white/[0.02] py-1.5 pl-3 pr-1.5 transition-[border-color,box-shadow] duration-300 sm:flex-nowrap',
          'focus-within:border-accent-soft/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_18%,transparent)]',
        )}
      >
        <Sparkles className={cn('mb-2 size-3.5 shrink-0 text-accent-soft', busy && 'animate-pulse')} strokeWidth={1.75} />
        <textarea
          ref={field}
          rows={1}
          value={prompt}
          maxLength={2000}
          disabled={!!busy}
          aria-label={`Describe the ${kind}`}
          placeholder={kind === 'image' ? 'Describe the image this post needs…' : 'Describe the video this post needs…'}
          onChange={(e) => {
            setPrompt(e.target.value)
            setDirty(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault()
              run()
            }
          }}
          className="block min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-snug outline-none placeholder:text-dim disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={busy ? undefined : run}
          disabled={!prompt.trim()}
          className={cn(
            'flex h-8 shrink-0 basis-full items-center justify-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors sm:basis-auto',
            busy
              ? 'cursor-default text-dim'
              : 'bg-accent text-white hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2} /> : <Sparkles className="size-3.5" strokeWidth={2} />}
          {busy ? `Making the ${kind}…` : `Make the ${kind}`}
        </button>
      </div>
      {busy && <p className="mt-1.5 font-mono text-[10px] text-dim">with {busy.model_label} — it joins the media when it’s done</p>}
      {error && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-fail">
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          {error}
          <button type="button" onClick={run} className="ml-1 inline-flex items-center gap-1 text-accent-soft hover:underline">
            <RotateCcw className="size-3" strokeWidth={2} /> Try again
          </button>
        </p>
      )}
    </div>
  )
}

function IconBtn({ label, onClick, icon: Icon, disabled }: { label: string; onClick: () => void; icon: typeof X; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-5 place-items-center rounded-full bg-black/70 text-white backdrop-blur transition-opacity disabled:opacity-0"
    >
      <Icon className="size-3" strokeWidth={2} />
    </button>
  )
}

const STATUS = {
  pass: { icon: Check, className: 'text-ok' },
  warn: { icon: TriangleAlert, className: 'text-warn' },
  fail: { icon: CircleAlert, className: 'text-fail' },
}

/**
 * The pre-export check, live as you write: each platform's spec against the caption and media.
 * When a phone will publish the post, a failure blocks scheduling; otherwise it's advice.
 */
export function ChecksPanel({
  platforms,
  caption,
  media,
  placement,
  onPlacement,
  blocking,
  error,
}: {
  platforms: PlatformId[]
  caption: string
  media: Asset[]
  placement: string | null
  onPlacement: (p: string) => void
  blocking: boolean
  error?: string
}) {
  const { data: specs } = useApi<Specs>('/platform-specs')
  const [results, setResults] = useState<SpecCheck[] | null>(null)
  const single = platforms.length === 1
  const key = useDebounced(JSON.stringify([platforms, single ? placement : null, caption, media.map((m) => m.id)]), 350)

  useEffect(() => {
    const [p, place, text, ids] = JSON.parse(key) as [PlatformId[], string | null, string, number[]]
    if (!p.length) return setResults(null)
    let cancelled = false
    api<SpecCheck[]>('/checks', { method: 'POST', body: { platforms: p, placements: place ? { [p[0]]: place } : {}, caption: text, asset_ids: ids } })
      .then((r) => !cancelled && setResults(r))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [key])

  if (!platforms.length) return null
  const failing = results?.filter((r) => !r.ok).length ?? 0

  return (
    <Panel
      title="Platform check"
      sub={blocking ? 'A phone will publish this, so it has to pass first.' : 'Sizes, lengths and limits, checked as you go.'}
      actions={results && <span className={cn('font-mono text-[10.5px]', failing ? (blocking ? 'text-fail' : 'text-warn') : 'text-ok')}>{failing ? `${failing} to fix` : 'All clear'}</span>}
      bodyClassName="space-y-3 p-3 pt-3"
    >
      {(results ?? []).map((r) => {
        const problems = r.checks.filter((c) => c.status !== 'pass')
        const placements = specs?.[r.platform] ?? {}
        return (
          <div key={r.platform} className={cn('rounded-lg border px-3 py-2.5', r.ok ? 'border-line' : blocking ? 'border-fail/40' : 'border-warn/30')}>
            <div className="flex items-center gap-2">
              <PlatformIcon id={r.platform} className="size-3.5 text-muted" />
              {single && Object.keys(placements).length > 1 ? (
                <select
                  value={r.placement}
                  onChange={(e) => onPlacement(e.target.value)}
                  aria-label={`${PLATFORMS[r.platform].name} placement`}
                  className="rounded bg-transparent text-[12.5px] font-medium outline-none [color-scheme:dark]"
                >
                  {Object.entries(placements).map(([id, p]) => (
                    <option key={id} value={id}>
                      {PLATFORMS[r.platform].name} {p.label.toLowerCase()}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[12.5px] font-medium">{r.label}</span>
              )}
              <span className={cn('ml-auto text-[11px]', r.ok ? 'text-ok' : blocking ? 'text-fail' : 'text-warn')}>{r.ok ? (problems.length ? 'Ready, with notes' : 'Ready') : 'Needs work'}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {(problems.length ? problems : r.checks).map((c) => {
                const S = STATUS[c.status]
                return (
                  <li key={c.key} className="flex gap-2 text-[11.5px] leading-snug text-muted">
                    <S.icon className={cn('mt-px size-3 shrink-0', S.className)} strokeWidth={2} />
                    <span>{c.detail}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {error && <p className="px-1 font-mono text-[11px] text-fail">{error}</p>}
    </Panel>
  )
}
