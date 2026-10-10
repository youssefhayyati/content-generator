import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowUpRight, AudioWaveform, Copy, Download, Images, LoaderCircle, Sparkles, Trash2 } from 'lucide-react'
import { useLenis } from 'lenis/react'
import { Serif } from '../../components/ui/Reveal'
import { api, type Account, type AiOptions, type Campaign, type CampaignSummary } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useQueryParam, useRouter } from '../../lib/router'
import { BriefTab } from '../campaign/BriefTab'
import { PlanTab } from '../campaign/PlanTab'
import { ProductionTab } from '../campaign/ProductionTab'
import { ReviewTab } from '../campaign/ReviewTab'
import { ScheduleTab } from '../campaign/ScheduleTab'
import { STAGE_LABEL, STEPS, Stepper, stageStep, tabFor, useCampaign, type Tab } from '../campaign/shared'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { briefText, copyText, downloadPackage } from '../intake/files'
import { useUser } from '../Shell'
import { useToast } from '../toast'
import { Btn, Label, Modal, PageHeader, Skeleton, Stagger } from '../ui'

const GREETING = 'Hi! I’m your campaign strategist. I’ll ask short questions so we can create content that really feels like you. How much time do you have?'

const DEPTHS = [
  { id: 'quick', name: 'Quick', count: '8', time: '2 min', body: 'The essentials. AI suggests the rest, and you can answer more later.' },
  { id: 'full', name: 'Full', count: '20', time: '8 min', body: 'Your story, your customers, your voice. The most personal content.' },
] as const

/** /dashboard/campaigns: start an intake or pick one up. With ?id=, that campaign's studio. */
export default function Campaigns() {
  const id = useQueryParam('id')
  return id ? <Open key={id} id={id} /> : <Start />
}

function Open({ id }: { id: string }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const lenis = useLenis()
  const [campaign, setCampaign] = useState<Campaign | null>(null)

  useEffect(() => {
    lenis?.scrollTo(0, { immediate: true, force: true })
    api<Campaign>(`/campaigns/${id}`)
      .then(setCampaign)
      .catch(() => {
        toast('That campaign doesn’t exist any more.', 'error')
        navigate('/dashboard/campaigns', { replace: true })
      })
  }, [id, lenis, toast, navigate])

  if (!campaign) {
    return (
      <div>
        <Skeleton className="h-24 w-2/3" />
        <div className="mt-8 space-y-4">
          <Skeleton className="h-16 rounded-xl" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
            <Skeleton className="h-[520px] rounded-xl" />
            <Skeleton className="h-[520px] rounded-xl" />
          </div>
        </div>
      </div>
    )
  }
  return <Studio initial={campaign} />
}

const isTab = (v: string | null): v is Tab => !!v && STEPS.some((s) => s.tab === v)

/**
 * One campaign, end to end: brief → plan (gate 6A) → production → review (gate 6B) → schedule.
 *
 * The step you're on follows the work rather than being chosen for you: when the stage you're
 * watching finishes, you move on with it. Stepping back to re-read the brief or the plan leaves
 * you there, because the stage that moved isn't the one you're looking at any more.
 */
function Studio({ initial }: { initial: Campaign }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const param = useQueryParam('tab')
  const { campaign, setCampaign, items, setItems, reload, busy } = useCampaign(initial.id, initial)
  const { data: accounts } = useApi<Account[]>('/accounts')
  const [tab, setTab] = useState<Tab>(isTab(param) ? param : tabFor(initial.stage))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const stage = useRef(initial.stage)

  const go = (next: Tab) => {
    setTab(next)
    navigate(`/dashboard/campaigns?id=${campaign.id}&tab=${next}`, { replace: true })
  }

  // The work moving on carries you with it, as long as you were watching the step that just ended.
  useEffect(() => {
    const was = stage.current
    if (was === campaign.stage) return
    stage.current = campaign.stage
    if (stageStep(campaign.stage) > stageStep(was) && tab === STEPS[stageStep(was)].tab) go(tabFor(campaign.stage))
  })

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text)
    toast(ok ? `${what} copied.` : 'Couldn’t copy. Select the text instead.', ok ? 'success' : 'error')
  }

  const remove = async () => {
    try {
      await api(`/campaigns/${campaign.id}`, { method: 'DELETE' })
      invalidate()
      toast('Campaign deleted.')
      navigate('/dashboard/campaigns')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t delete the campaign.', 'error')
    }
  }

  const shared = { campaign, items, accounts: accounts ?? [], reload }

  return (
    <div>
      <PageHeader
        eyebrow={STAGE_LABEL[campaign.stage]}
        title={
          campaign.title ? (
            <span className="block max-w-[22ch] truncate">{campaign.title}</span>
          ) : (
            <>
              New <Serif>campaign.</Serif>
            </>
          )
        }
        actions={
          <>
            <Btn variant="subtle" icon={ArrowLeft} onClick={() => navigate('/dashboard/campaigns')} aria-label="All campaigns">
              <span className="hidden xl:inline">All campaigns</span>
            </Btn>
            {campaign.items_count > 0 && (
              <Btn icon={AudioWaveform} onClick={() => navigate(`/dashboard/assistant?campaign=${campaign.id}`)} title="Its posts as drafts you change by voice or by hand">
                <span className="hidden sm:inline">Open in the assistant</span>
              </Btn>
            )}
            <Btn icon={Copy} onClick={() => copy(briefText(campaign), 'Brief')}>
              Copy brief
            </Btn>
            <Btn icon={Download} onClick={() => downloadPackage(campaign).catch(() => toast('Couldn’t put the package together. Try again.', 'error'))}>
              Download
            </Btn>
            <Btn variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)} aria-label="Delete campaign" />
          </>
        }
      />

      <div className="mt-6">
        <Stepper stage={campaign.stage} tab={tab} onTab={go} />
      </div>

      <div className="mt-4">
        {tab === 'brief' && <BriefTab campaign={campaign} accounts={accounts ?? []} onChange={setCampaign} onPlanned={() => go('plan')} />}
        {tab === 'plan' && <PlanTab {...shared} onCampaign={setCampaign} onItems={setItems} />}
        {tab === 'production' && <ProductionTab {...shared} busy={busy} onReview={() => go('review')} />}
        {tab === 'review' && <ReviewTab {...shared} onItems={setItems} onSchedule={() => go('schedule')} />}
        {tab === 'schedule' && <ScheduleTab {...shared} onCampaign={setCampaign} />}
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this campaign?">
        <p className="text-[13px] leading-snug text-muted">
          The brief, the plan, the content and everything made for it go with it. This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="subtle" onClick={() => setConfirmDelete(false)}>
            Keep it
          </Btn>
          <Btn variant="danger" icon={Trash2} onClick={remove}>
            Delete campaign
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

function Start() {
  const user = useUser()
  const toast = useToast()
  const { navigate } = useRouter()
  const { data: list, loading } = useApi<CampaignSummary[]>('/campaigns')
  const { data: ai } = useApi<AiOptions>('/ai')
  const [starting, setStarting] = useState<string | null>(null)

  const start = async (depth: 'quick' | 'full') => {
    if (starting) return
    setStarting(depth)
    try {
      const c = await api<Campaign>('/campaigns', { method: 'POST', body: { depth } })
      navigate(`/dashboard/campaigns?id=${c.id}`)
    } catch (e) {
      setStarting(null)
      toast(e instanceof Error ? e.message : 'Couldn’t start the interview.', 'error')
    }
  }

  const noAi =
    ai && !ai.enabled
      ? 'AI isn’t switched on yet, so you’ll get the standard questions. The content kit needs AI.'
      : !user.email_verified
        ? 'Confirm your email to have AI run the interview and write the content kit. Until then, you’ll get the standard questions.'
        : null

  return (
    <div>
      <PageHeader
        eyebrow="Campaigns"
        title={
          <>
            Campaign <Serif>intake.</Serif>
          </>
        }
        sub="Answer short questions and share a few photos. You get a client brief, and a content kit to make posts from."
      />

      <Stagger i={0} className="mt-10">
        <section className="relative overflow-hidden rounded-2xl border border-line bg-panel p-4 md:p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-32 size-[420px] rounded-full opacity-60 blur-3xl"
            style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 65%)' }}
          />
          <div className="relative max-w-[560px] rounded-2xl rounded-bl-md border border-line bg-white/[0.04] px-4 py-3 text-[14px] leading-snug">
            <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">Strategist</span>
            {GREETING}
          </div>

          <div className="relative mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-[880px]">
            {DEPTHS.map((d, i) => (
              <motion.button
                key={d.id}
                type="button"
                onClick={() => start(d.id)}
                disabled={!!starting}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease, delay: 0.2 + i * 0.08 }}
                whileTap={{ scale: 0.985 }}
                className={cn(
                  'group relative flex min-h-[190px] flex-col overflow-hidden rounded-xl border p-5 text-left transition-[border-color,background-color,box-shadow] duration-500',
                  'border-line-2 bg-panel-2 hover:border-accent-soft/60 hover:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_14%,transparent)] disabled:cursor-wait',
                  starting === d.id && 'border-accent-soft/60',
                )}
              >
                <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  <span className="text-fg">{d.name}</span>
                  <span className="h-px w-5 bg-current opacity-40" />
                  {d.time}
                </span>
                <span className="mt-4 flex items-baseline gap-2">
                  <span className="text-[64px] font-medium leading-[0.85] tracking-[-0.06em] transition-colors duration-500 group-hover:text-accent-soft">
                    {d.count}
                  </span>
                  <Serif className="text-[22px] text-muted">questions</Serif>
                </span>
                <span className="mt-auto max-w-[34ch] pt-4 text-[13px] leading-snug text-muted">{d.body}</span>
                <span className="absolute right-4 top-4 grid size-8 place-items-center rounded-full border border-line-2 text-muted transition-[transform,color,border-color] duration-500 ease-expo group-hover:rotate-45 group-hover:border-accent-soft/60 group-hover:text-fg">
                  {starting === d.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUpRight className="size-3.5" strokeWidth={1.75} />}
                </span>
              </motion.button>
            ))}
          </div>
          {noAi && <p className="relative mt-4 text-[12px] text-dim">{noAi}</p>}
        </section>
      </Stagger>

      {(loading || (list && list.length > 0)) && (
        <Stagger i={1} className="mt-12">
          <div className="flex items-baseline justify-between">
            <Label>Your campaigns</Label>
            {list && <span className="font-mono text-[10px] text-dim">{list.length}</span>}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {!list
              ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[148px] rounded-xl" />)
              : list.map((c, i) => <CampaignCard key={c.id} campaign={c} i={i} onOpen={() => navigate(`/dashboard/campaigns?id=${c.id}`)} />)}
          </div>
        </Stagger>
      )}
    </div>
  )
}

function CampaignCard({ campaign: c, i, onOpen }: { campaign: CampaignSummary; i: number; onOpen: () => void }) {
  // Past the brief, where it is in the pipeline says more than whether a kit exists.
  const status = c.stage !== 'brief' ? STAGE_LABEL[c.stage] : c.has_kit ? 'Kit ready' : c.complete ? 'Brief ready' : 'Interview'
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: Math.min(i, 8) * 0.04 }}
      className="group flex min-w-0 flex-col rounded-xl border border-line bg-panel p-4 text-left transition-colors duration-300 hover:border-line-2 hover:bg-panel-2"
    >
      <span className="flex items-start justify-between gap-3">
        <span className={cn('min-w-0 truncate text-[14px] font-medium tracking-[-0.01em]', !c.title && 'text-muted')}>
          {c.title ?? 'Untitled campaign'}
        </span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
            c.has_kit ? 'border-accent/30 text-accent-soft' : c.complete ? 'border-ok/25 text-ok' : 'border-white/10 text-muted',
          )}
        >
          {c.has_kit ? <Sparkles className="size-3" strokeWidth={1.75} /> : <span className={cn('size-1.5 rounded-full', c.complete ? 'bg-ok' : 'bg-draft')} />}
          {status}
        </span>
      </span>
      <span className="mt-1 font-mono text-[10.5px] text-dim">
        {c.depth === 'quick' ? 'Quick' : 'Full'} · {fmtRelative(c.updated_at)}
      </span>
      <span className="mt-auto block pt-5">
        <span className="flex items-center justify-between text-[11px] text-dim">
          <span className="tabular-nums">
            {c.filled} of {c.total} answered
          </span>
          {c.photo_count > 0 && (
            <span className="flex items-center gap-1">
              <Images className="size-3" strokeWidth={1.75} />
              {c.photo_count}
            </span>
          )}
        </span>
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <span className="block h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${(c.filled / c.total) * 100}%` }} />
        </span>
      </span>
    </motion.button>
  )
}
