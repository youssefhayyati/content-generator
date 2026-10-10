import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, CalendarCheck, Hand, LoaderCircle, Send, Smartphone, Square } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { fmtTime } from '../data'
import { Btn, Segmented } from '../ui'
import { useAssistant, type Draft, type PhonePost } from './store'

const LOOK: Record<PhonePost['status'], { label: string; tone: string; box: string }> = {
  posted: { label: 'Posted from the phone', tone: 'text-ok', box: 'border-ok/25 bg-ok/[0.04]' },
  unsure: { label: 'Maybe posted: check the account', tone: 'text-warn', box: 'border-warn/30 bg-warn/[0.04]' },
  failed: { label: 'Not posted', tone: 'text-fail', box: 'border-fail/25 bg-fail/[0.04]' },
  posting: { label: 'Posting from the phone', tone: 'text-accent-soft', box: 'border-accent/30 bg-accent/[0.05]' },
}

const LIVE: Record<string, string> = {
  starting: 'Starting',
  started: 'Working',
  running: 'Working',
  'awaiting approval': 'Waits for your OK',
  'trying again': 'Trying again',
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The phone's screen as it ended: small, and the whole of it in a new tab. */
function Proof({ src, className }: { src: string; className?: string }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Open the screenshot" className={cn('block shrink-0 overflow-hidden rounded-md border border-line bg-white/[0.04]', className)}>
      <img src={src} alt="The phone’s screen when it finished" loading="lazy" className="size-full object-cover object-top" />
    </a>
  )
}

/** In the conversation, once a job on the phone ends: a post's outcome, or another job's answer, with the proof. */
export function PhoneCard({ post, text, proof, failed }: { post?: number; text?: string; proof?: string | null; failed?: boolean }) {
  const a = useAssistant()
  const p = post != null ? a.phone[post] : null
  if (post != null && !p) return null
  const look = p ? LOOK[p.status] : failed ? LOOK.failed : { label: 'The phone is done', tone: 'text-ok', box: 'border-line bg-white/[0.02]' }
  const shot = p ? p.proof : proof

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }} className={cn('ml-7 flex gap-3 rounded-lg border p-2.5', look.box)}>
      {shot && <Proof src={shot} className="h-32 w-[58px]" />}
      <div className="min-w-0 flex-1">
        <p className={cn('flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]', look.tone)}>
          <Smartphone className="size-3 shrink-0" />
          {look.label}
        </p>
        {p ? (
          <>
            <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium leading-snug">
              <PlatformIcon id={p.platform} className="size-3 shrink-0" />
              <span className="truncate">
                {p.title || `Draft ${p.draft}`} · {p.what}
              </span>
            </p>
            <p className="mt-0.5 font-mono text-[10.5px] text-dim">
              {p.posted ? `Up at ${fmtTime(p.posted)}` : `Post ${p.post}`}
              {p.attempts > 1 && ` · ${p.attempts} tries`}
            </p>
            {(p.proof_note || p.detail) && <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-snug text-muted">{p.status === 'failed' ? p.detail || p.proof_note : p.proof_note}</p>}
            {p.recorded && p.status !== 'failed' && (
              <button type="button" onClick={() => a.setTab('calendar')} className="mt-2 flex items-center gap-1.5 text-[11.5px] text-accent-soft hover:underline">
                <CalendarCheck className="size-3" />
                On the calendar{p.flowai_post ? ` as post ${p.flowai_post}` : ''}
              </button>
            )}
          </>
        ) : (
          text && <p className="mt-1.5 line-clamp-4 text-[12px] leading-snug text-muted">{text}</p>
        )}
      </div>
    </motion.div>
  )
}

/** While the phone works for this conversation: what it's doing, its screen, and a way to stop it. */
export function PhoneLiveBar() {
  const a = useAssistant()
  const live = a.phoneLive
  const [now, setNow] = useState(() => Date.now())
  const [big, setBig] = useState(false)

  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [live])

  if (!live) return null
  const waiting = Object.values(a.phone).filter((p) => p.waiting).length

  return (
    <div className="flex items-start gap-3 border-t border-line px-4 py-2.5 md:px-5">
      <button
        type="button"
        onClick={() => setBig((b) => !b)}
        title={big ? 'Smaller' : 'See the phone’s screen'}
        className={cn('grid shrink-0 place-items-center overflow-hidden rounded-[5px] border border-line bg-white/[0.04] transition-[width,height]', big ? 'h-72 w-[130px]' : 'h-14 w-[26px]')}
      >
        {live.screenshot ? <img src={live.screenshot} alt="The phone’s screen now" className="size-full object-cover object-top" /> : <Smartphone className="size-3.5 text-dim" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]', live.status === 'awaiting approval' ? 'text-warn' : 'text-accent-soft')}>
          <LoaderCircle className="size-3 animate-spin" />
          {LIVE[live.status] ?? live.status} · {mmss(now - live.started)}
          {live.driver && <span className="normal-case tracking-normal text-dim">· {live.driver === 'direct' ? 'direct control' : 'phone agent'}</span>}
          {waiting > 0 && <span className="normal-case tracking-normal text-dim">· {waiting} more waiting</span>}
        </p>
        <p className="mt-0.5 truncate text-[12.5px]">{live.text}</p>
        {live.step && <p className="line-clamp-2 text-[11.5px] leading-snug text-dim">{live.step}</p>}
      </div>
      <Btn size="sm" variant="subtle" icon={Square} onClick={a.cancelPhone}>
        Stop
      </Btn>
    </div>
  )
}

/** In a draft's inspector: its latest post from the phone, and the proof. */
export function DraftPhonePost({ draft }: { draft: number }) {
  const a = useAssistant()
  const p = Object.values(a.phone)
    .filter((x) => x.draft === draft)
    .sort((x, y) => y.post - x.post)[0]
  if (!p) return null
  const look = LOOK[p.status]
  const step = p.status === 'posting' && a.phoneLive?.post === p.post ? a.phoneLive.step : undefined

  return (
    <div className={cn('mt-3 flex items-center gap-2.5 rounded-lg border p-2', look.box)}>
      {p.proof ? <Proof src={p.proof} className="h-12 w-[22px] rounded-[4px]" /> : <Smartphone className={cn('size-3.5 shrink-0', look.tone)} />}
      <div className="min-w-0 flex-1">
        <p className={cn('flex items-center gap-1.5 text-[11.5px] font-medium', look.tone)}>
          {p.status === 'posting' && <LoaderCircle className="size-3 animate-spin" />}
          {p.waiting ? 'Waiting its turn on the phone' : look.label}
          {p.posted && <span className="font-mono text-[10.5px] font-normal text-dim">· {fmtTime(p.posted)}</span>}
        </p>
        {(step || p.proof_note) && <p className="truncate text-[11px] text-dim">{step || p.proof_note}</p>}
      </div>
      {p.recorded && p.status !== 'failed' && (
        <Btn size="sm" variant="subtle" icon={CalendarCheck} onClick={() => a.setTab('calendar')}>
          Calendar
        </Btn>
      )}
    </div>
  )
}

/** In a draft's inspector: who drives the phone (a switch, for every post from the next one), and posting the draft
 * from it now. Posting is public, so the button asks once more before it goes. */
export function PostFromPhone({ d }: { d: Draft }) {
  const a = useAssistant()
  const pd = a.phoneDriver
  const [sure, setSure] = useState(false)

  useEffect(() => {
    if (!sure) return
    const t = window.setTimeout(() => setSure(false), 5000)
    return () => window.clearTimeout(t)
  }, [sure])

  if (!pd) return null
  const last = Object.values(a.phone)
    .filter((x) => x.draft === d.id)
    .sort((x, y) => y.post - x.post)[0]
  const posting = last?.status === 'posting'
  const up = last?.status === 'posted' || last?.status === 'unsure'
  const failing = (d.check.checks ?? []).some((c) => c.status === 'fail')
  const blocked = posting ? 'It’s being posted' : failing ? 'Fix what the check flags first' : d.platform === 'instagram' && !d.slides.length ? 'Add a picture first' : ''
  const post = () => {
    if (!sure) return setSure(true)
    setSure(false)
    a.action('post_phone', { draft: d.id, again: up })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          id="phone-driver"
          label="Who drives the phone"
          value={pd.driver}
          onChange={(driver) => a.setPhoneDriver(driver, pd.fallback)}
          options={[
            { value: 'agent', label: <><Bot className="size-3.5" />Phone agent</> },
            { value: 'direct', label: <><Hand className="size-3.5" />Direct control</> },
          ]}
        />
        <Btn size="sm" variant={sure ? 'danger' : 'primary'} icon={posting ? LoaderCircle : Send} disabled={!!blocked} title={blocked || undefined} onClick={post} className={posting ? '[&>svg]:animate-spin' : undefined}>
          {posting ? 'Posting…' : sure ? 'Post publicly now?' : up ? 'Post again' : 'Post now'}
        </Btn>
        {sure && (
          <Btn size="sm" variant="subtle" onClick={() => setSure(false)}>
            Cancel
          </Btn>
        )}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-dim">
        {pd.driver === 'direct'
          ? 'Direct control: the assistant drives the phone itself. It looks at the screen and taps, types and swipes, with no agent in between.'
          : pd.agent_down
            ? `The phone’s agent ${pd.agent_down}, so direct control posts for now.`
            : 'The phone’s own agent posts it.'}
        {!pd.direct_ok && ' Direct control needs a vision model (OLLAMA_API_KEY on the assistant).'}
      </p>
      {pd.driver === 'agent' && pd.direct_ok && (
        <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[11.5px] text-muted">
          <input type="checkbox" checked={pd.fallback} onChange={(e) => a.setPhoneDriver('agent', e.target.checked)} className="accent-[var(--color-accent)]" />
          Direct control takes over if the agent fails
        </label>
      )}
      <DraftPhonePost draft={d.id} />
    </div>
  )
}
