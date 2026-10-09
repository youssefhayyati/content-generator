import { useState } from 'react'
import { motion } from 'framer-motion'
import { CloudLightning, Settings2, ShieldCheck, Sun } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { api, ApiError, type StormPressure } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, inputClass, Label, Modal, Toggle } from '../ui'

const tone = (p: StormPressure) =>
  !p.enabled ? { name: 'Off', color: 'var(--color-dim)' } : p.tripped ? { name: 'Frozen', color: 'var(--color-fail)' } : p.pressure >= 85 ? { name: 'Stormy', color: 'var(--color-fail)' } : p.pressure >= 45 ? { name: 'Choppy', color: 'var(--color-warn)' } : { name: 'Calm', color: 'var(--color-ok)' }

/**
 * Storm Guard, per account: how close its comments are to a backlash, and — when they got
 * there — the freeze, what it holds, and the all clear.
 */
export function StormGuard() {
  const { data } = useApi<StormPressure[]>('/storm-guard')
  const [editing, setEditing] = useState<StormPressure | null>(null)
  if (!data?.length) return null

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Label className="flex items-center gap-2">
            <ShieldCheck className="size-3" /> Storm Guard
          </Label>
          <p className="mt-1 max-w-[70ch] text-[12.5px] leading-snug text-dim">
            Every comment gets a read the moment it lands. When an account’s comments turn negative fast, its publishing freezes on its own, so nothing scheduled walks into a backlash.
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((p, i) => (
          <Weather key={p.account_id} p={p} i={i} onSettings={() => setEditing(p)} />
        ))}
      </div>
      <Settings p={editing} onClose={() => setEditing(null)} />
    </section>
  )
}

function Weather({ p, i, onSettings }: { p: StormPressure; i: number; onSettings: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const t = tone(p)

  const clear = async () => {
    setBusy(true)
    try {
      await api(`/accounts/${p.account_id}/storm-guard/clear`, { method: 'POST' })
      invalidate()
      toast(`All clear on @${p.handle}. Publishing resumes.`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t clear it.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: i * 0.05 }}
      className={cn(
        'relative overflow-hidden rounded-xl border bg-panel p-4',
        p.tripped ? 'border-fail/40 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-fail)_25%,transparent),0_24px_70px_-36px_var(--color-fail)]' : 'border-line',
      )}
    >
      {p.tripped && (
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_100%_0%,color-mix(in_oklab,var(--color-fail)_14%,transparent),transparent)]" />
      )}
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <PlatformIcon id={p.platform} className="size-3.5 shrink-0 text-muted" />
          <span className="truncate text-[13px] font-medium">@{p.handle}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium" style={{ color: t.color, borderColor: `color-mix(in oklab, ${t.color} 35%, transparent)` }}>
            {p.tripped ? <CloudLightning className="size-3" /> : <span className="size-1.5 rounded-full" style={{ background: t.color }} />}
            {t.name}
          </span>
          <button type="button" onClick={onSettings} aria-label={`Storm Guard settings for @${p.handle}`} className="text-dim transition-colors hover:text-fg">
            <Settings2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="relative mt-3 flex items-center gap-4">
        <Gauge value={p.tripped ? 100 : p.pressure} color={t.color} label={`${p.share}%`} />
        <div className="min-w-0 text-[11.5px] leading-snug text-dim">
          <p>
            <span className="text-muted">{p.negative}</span> of {p.total} {p.total === 1 ? 'comment' : 'comments'} in the last {p.window_minutes < 60 ? `${p.window_minutes} min` : p.window_minutes === 60 ? 'hour' : `${p.window_minutes / 60} h`} negative.
          </p>
          <p className="mt-0.5">
            {p.enabled ? `Freezes at ${p.threshold}% over ${p.min_comments}+ comments.` : 'Watching, but switched off: it never freezes.'}
          </p>
        </div>
      </div>

      {p.tripped && (
        <div className="relative mt-4 border-t border-fail/20 pt-3">
          <p className="text-[12px] leading-snug text-fail">{p.reason}</p>
          <p className="mt-1 text-[11.5px] text-dim">
            Frozen {p.storm_at ? fmtRelative(p.storm_at) : ''}. {p.held_posts} scheduled {p.held_posts === 1 ? 'post' : 'posts'} held — what you approve from now on still goes out.
          </p>
          <Btn size="sm" icon={Sun} loading={busy} onClick={clear} className="mt-3">
            All clear
          </Btn>
        </div>
      )}
    </motion.article>
  )
}

/** Half a dial: how close the account is to freezing. Full means frozen. */
function Gauge({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 30
  const arc = `M ${36 - r} 36 A ${r} ${r} 0 0 1 ${36 + r} 36`
  return (
    <svg viewBox="0 0 72 42" className="h-[46px] w-[78px] shrink-0 overflow-visible" aria-label={`${value}% of the way to a freeze`}>
      <path d={arc} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={6} strokeLinecap="round" />
      <motion.path d={arc} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: Math.max(0.02, value / 100) }} transition={{ duration: 1.1, ease }} />
      <text x="36" y="35" textAnchor="middle" className="fill-fg font-mono text-[11px] tabular-nums">
        {label}
      </text>
    </svg>
  )
}

function Settings({ p, onClose }: { p: StormPressure | null; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState<Pick<StormPressure, 'enabled' | 'threshold' | 'min_comments' | 'window_minutes'> | null>(null)
  const [saving, setSaving] = useState(false)
  const v = draft ?? (p ? { enabled: p.enabled, threshold: p.threshold, min_comments: p.min_comments, window_minutes: p.window_minutes } : null)

  const close = () => {
    setDraft(null)
    onClose()
  }

  const save = async () => {
    if (!p || !v) return
    setSaving(true)
    try {
      await api(`/accounts/${p.account_id}/storm-guard`, { method: 'PUT', body: v })
      invalidate()
      toast('Storm Guard updated.')
      close()
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t save.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!p} onClose={close} title={p ? `Storm Guard · @${p.handle}` : 'Storm Guard'}>
      {v && (
        <div className="space-y-5">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-[13px] font-medium">Freeze on a backlash</span>
              <span className="block text-[12px] text-dim">Off, it still reads every comment, but never holds anything.</span>
            </span>
            <Toggle on={v.enabled} onChange={(enabled) => setDraft({ ...v, enabled })} label="Storm Guard on" />
          </label>
          <label className="block">
            <Label>Freeze when this share is negative · {v.threshold}%</Label>
            <input type="range" min={20} max={100} step={5} value={v.threshold} onChange={(e) => setDraft({ ...v, threshold: Number(e.target.value) })} className="mt-3 w-full accent-[var(--color-accent)]" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label>Of at least</Label>
              <input type="number" min={2} max={500} value={v.min_comments} onChange={(e) => setDraft({ ...v, min_comments: Number(e.target.value) })} className={cn(inputClass, 'mt-2')} />
            </label>
            <label className="block">
              <Label>Comments within</Label>
              <select value={v.window_minutes} onChange={(e) => setDraft({ ...v, window_minutes: Number(e.target.value) })} className={cn(inputClass, 'mt-2')}>
                {[15, 30, 60, 120, 240, 720, 1440].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Btn variant="subtle" onClick={close}>
              Cancel
            </Btn>
            <Btn variant="primary" loading={saving} onClick={save}>
              Save
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** A comment's mood, as read on arrival (and refined by triage). */
export function Mood({ sentiment }: { sentiment: number | null }) {
  if (sentiment === null) return null
  const m = sentiment >= 25 ? { label: 'Warm', color: 'var(--color-ok)' } : sentiment <= -25 ? { label: 'Upset', color: 'var(--color-fail)' } : { label: 'Neutral', color: 'var(--color-dim)' }
  return (
    <span title={`Mood ${sentiment > 0 ? '+' : ''}${sentiment}`} className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: m.color }}>
      <span className="size-1.5 rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  )
}
