import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Brush, CalendarClock, Check, CircleAlert, Clapperboard, FileText, Image as ImageIcon, Images, LoaderCircle, PenLine, ShieldCheck, Shuffle, Wand2 } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { api, type Account, type AgentStepInfo, type Campaign, type CampaignItem, type CampaignStage } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'

export const FORMAT_ICON = { text: FileText, image: ImageIcon, carousel: Images, video: Clapperboard }
export const FORMAT_LABEL = { text: 'Text', image: 'Photo', carousel: 'Carousel', video: 'Video' }

export const AGENT: Record<AgentStepInfo['agent'], { label: string; icon: typeof PenLine }> = {
  writer: { label: 'Writer', icon: PenLine },
  visual_director: { label: 'Visual director', icon: Brush },
  media: { label: 'Media team', icon: Wand2 },
  adapter: { label: 'Adapter', icon: Shuffle },
  qa: { label: 'QA', icon: ShieldCheck },
  scheduler: { label: 'Scheduler', icon: CalendarClock },
  publisher: { label: 'Publisher', icon: Check },
}

export type Tab = 'brief' | 'plan' | 'production' | 'review' | 'schedule'

/** The steps of a campaign, and which ones a person has to sign off. */
export const STEPS: Array<{ tab: Tab; label: string; gate?: string }> = [
  { tab: 'brief', label: 'Brief' },
  { tab: 'plan', label: 'Plan', gate: '6A' },
  { tab: 'production', label: 'Production' },
  { tab: 'review', label: 'Review', gate: '6B' },
  { tab: 'schedule', label: 'Schedule' },
]

const STAGE_STEP: Record<CampaignStage, number> = { brief: 0, planning: 1, plan_review: 1, producing: 2, adapting: 2, content_review: 3, scheduled: 4 }
export const stageStep = (s: CampaignStage) => STAGE_STEP[s]
export const tabFor = (s: CampaignStage): Tab => STEPS[STAGE_STEP[s]].tab

export const STAGE_LABEL: Record<CampaignStage, string> = {
  brief: 'Brief',
  planning: 'Planning',
  plan_review: 'Plan to approve',
  producing: 'In production',
  adapting: 'Adapting',
  content_review: 'Content to approve',
  scheduled: 'Scheduled',
}

/** Agents or media are working: worth checking back every few seconds. */
export const isBusy = (c: Campaign | null, items: CampaignItem[] | null) =>
  !!c && (['planning', 'producing', 'adapting'].includes(c.stage) || !!items?.some((i) => i.generating > 0 || i.variants.some((v) => v.status === 'rejected')))

/** The campaign and its items, refreshed while anything is being made. */
export function useCampaign(id: number, initial: Campaign) {
  const [campaign, setCampaign] = useState<Campaign>(initial)
  const [items, setItems] = useState<CampaignItem[] | null>(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    const [c, list] = await Promise.all([api<Campaign>(`/campaigns/${id}`), api<CampaignItem[]>(`/campaigns/${id}/items`)])
    if (!alive.current) return
    setCampaign(c)
    setItems(list)
  }, [id])

  useEffect(() => {
    alive.current = true
    reload().catch(() => {})
    return () => {
      alive.current = false
    }
  }, [reload])

  const busy = isBusy(campaign, items)
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => reload().catch(() => {}), 3000)
    return () => window.clearInterval(t)
  }, [busy, reload])

  return { campaign, setCampaign, items, setItems, reload, busy }
}

export function Stepper({ stage, tab, onTab }: { stage: CampaignStage; tab: Tab; onTab: (t: Tab) => void }) {
  const at = stageStep(stage)
  return (
    <nav aria-label="Campaign steps" className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1">
      {STEPS.map((s, i) => {
        const done = i < at || (i === at && stage === 'scheduled')
        const current = i === at && stage !== 'scheduled'
        // Steps ahead of the stage are closed off, except the one you're on: gate 6B sends you
        // to the schedule before the campaign is scheduled, and that step can't look disabled.
        const reachable = i <= at || s.tab === tab
        return (
          <button
            key={s.tab}
            type="button"
            disabled={!reachable}
            onClick={() => onTab(s.tab)}
            aria-current={tab === s.tab ? 'step' : undefined}
            className={cn(
              'relative flex min-w-[124px] flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors disabled:cursor-not-allowed',
              tab === s.tab ? 'text-fg' : reachable ? 'text-muted hover:text-fg' : 'text-dim/60',
            )}
          >
            {tab === s.tab && <motion.span layoutId="campaign-step" className="absolute inset-0 rounded-lg bg-white/[0.06]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <span
              className={cn(
                'relative grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[9.5px]',
                done ? 'border-ok/40 bg-ok/15 text-ok' : current ? 'border-accent-soft/60 text-accent-soft' : 'border-line-2',
              )}
            >
              {done ? <Check className="size-3" strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="relative min-w-0">
              <span className="block text-[12.5px] font-medium">{s.label}</span>
              {s.gate && <span className="block font-mono text-[9.5px] text-dim">gate {s.gate}</span>}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

/** The agents' turns, oldest first: who, what they did, what it cost. */
export function AgentTimeline({ steps, working }: { steps: AgentStepInfo[]; working?: string | null }) {
  return (
    <ol className="relative space-y-3 pl-6 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-line-2">
      {steps.map((s, i) => {
        const A = AGENT[s.agent]
        return (
          <motion.li key={s.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease, delay: Math.min(i, 10) * 0.03 }} className="relative">
            <span
              className={cn(
                'absolute -left-6 top-0.5 grid size-[19px] place-items-center rounded-full border bg-panel',
                s.status === 'failed' ? 'border-fail/50 text-fail' : s.status === 'running' ? 'border-accent-soft/60 text-accent-soft' : 'border-line-2 text-muted',
              )}
            >
              {s.status === 'running' ? <LoaderCircle className="size-3 animate-spin" /> : s.status === 'failed' ? <CircleAlert className="size-3" strokeWidth={2} /> : <A.icon className="size-2.5" strokeWidth={2} />}
            </span>
            <p className="flex items-baseline gap-2 text-[12.5px]">
              <span className="font-medium">{A.label}</span>
              {s.cost > 0 && <span className="font-mono text-[10px] text-dim">${s.cost.toFixed(3)}</span>}
            </p>
            <p className={cn('mt-0.5 text-[12px] leading-snug', s.status === 'failed' ? 'text-fail' : 'text-dim')}>{s.status === 'failed' ? s.error : (s.summary ?? 'Working…')}</p>
          </motion.li>
        )
      })}
      {working && (
        <li className="relative">
          <span className="absolute -left-6 top-0.5 grid size-[19px] place-items-center rounded-full border border-accent-soft/60 bg-panel text-accent-soft">
            <LoaderCircle className="size-3 animate-spin" />
          </span>
          <p className="text-[12.5px] text-accent-soft">{working}</p>
        </li>
      )}
    </ol>
  )
}

export function AccountChips({ ids, accounts, className }: { ids: number[]; accounts: Account[]; className?: string }) {
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {ids.map((id) => {
        const a = accounts.find((x) => x.id === id)
        return a ? (
          <span key={id} className="inline-flex items-center gap-1 rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-muted">
            <PlatformIcon id={a.platform} className="size-3" />@{a.handle}
          </span>
        ) : null
      })}
    </span>
  )
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'fail' | 'accent' | 'dim'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
        { ok: 'border-ok/30 text-ok', warn: 'border-warn/30 text-warn', fail: 'border-fail/30 text-fail', accent: 'border-accent/30 text-accent-soft', dim: 'border-white/10 text-muted' }[tone],
      )}
    >
      {children}
    </span>
  )
}
