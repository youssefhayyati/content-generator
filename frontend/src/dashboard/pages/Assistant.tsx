import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, Images, Megaphone, PenLine, Plus, TriangleAlert } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useQueryParam, useRouter } from '../../lib/router'
import { CalendarView } from '../assistant/CalendarView'
import { Conversation } from '../assistant/Conversation'
import { CampaignPicker } from '../assistant/Conversations'
import { DraftView } from '../assistant/DraftView'
import { MediaView } from '../assistant/MediaView'
import { useAssistant, type AssistantTab } from '../assistant/store'
import { Btn, PageHeader, Segmented, Stagger } from '../ui'

const CONN = {
  idle: { label: 'Not connected', dot: 'bg-draft' },
  connecting: { label: 'Connecting', dot: 'bg-warn animate-pulse' },
  online: { label: 'Online', dot: 'bg-ok' },
  offline: { label: 'Offline', dot: 'bg-fail' },
}

/**
 * /dashboard/assistant: talk to the voice assistant on the left; on the right, what it makes
 * (the draft as it will look, the pictures, the calendar), all of which can be changed by hand.
 * The conversation itself lives above the pages (AssistantProvider), so it carries on elsewhere,
 * and the assistant keeps every conversation, so any of them can be picked up again.
 * ?campaign=<id> opens that FlowAI campaign in a new conversation (the Campaigns page links here).
 */
export default function Assistant() {
  const a = useAssistant()
  const { navigate } = useRouter()
  const campaign = useQueryParam('campaign')
  const [picking, setPicking] = useState(false)
  const conn = CONN[a.conn]
  const drafts = Object.keys(a.drafts).length

  // Opening the page starts the conversation; it stays open while you visit other pages.
  useEffect(() => a.start(), [a.start])

  useEffect(() => {
    if (!campaign || !Number(campaign)) return
    a.newConversation(Number(campaign))
    navigate('/dashboard/assistant', { replace: true })
    // Once per link: the page's own state isn't a reason to open it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign])

  const tabs: Array<{ value: AssistantTab; label: ReactNode }> = [
    { value: 'draft', label: <Tab icon={PenLine} label="Draft" n={drafts} /> },
    { value: 'media', label: <Tab icon={Images} label="Media" n={a.pictures.length + Object.keys(a.jobs).length} /> },
    { value: 'calendar', label: <Tab icon={CalendarDays} label="Calendar" /> },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Assistant"
        title={
          <>
            Say it. <Serif>Watch it happen.</Serif>
          </>
        }
        sub="Talk or type. It writes Instagram and X posts as you watch, changes them when you ask, saves them to FlowAI and books them once you approve. Every conversation is kept, so you can run one per campaign, or open a campaign here to change its posts."
        actions={
          <>
            <span className="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-[12px] text-muted">
              <span className={cn('size-1.5 rounded-full', conn.dot)} />
              {conn.label}
            </span>
            <Btn icon={Megaphone} onClick={() => setPicking(true)}>
              Open a campaign
            </Btn>
            <Btn icon={Plus} onClick={() => a.newConversation()} disabled={a.conn !== 'online'}>
              New conversation
            </Btn>
          </>
        }
      />

      <div className="mt-8 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start">
        <Stagger i={0} className="xl:sticky xl:top-[4.5rem]">
          <Conversation className="h-[540px] xl:h-[min(860px,calc(100dvh-6rem))]" onImport={() => setPicking(true)} />
        </Stagger>

        <Stagger i={1} className="@container min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented id="assistant-tab" label="View" options={tabs} value={a.tab} onChange={a.setTab} />
            <div className="flex flex-wrap items-center gap-1.5">
              {a.flowaiError && !a.accounts.length ? (
                <span className="flex items-center gap-1.5 rounded-full border border-warn/30 px-2.5 py-1 text-[11px] text-warn">
                  <TriangleAlert className="size-3" /> Not linked to FlowAI
                </span>
              ) : (
                a.accounts.map((x) => (
                  <span key={x.id} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted" title={x.label}>
                    <PlatformIcon id={x.platform} className="size-3 text-fg" />@{x.handle}
                  </span>
                ))
              )}
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={a.tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }} transition={{ duration: 0.35, ease }}>
              {a.tab === 'draft' ? <DraftView /> : a.tab === 'media' ? <MediaView /> : <CalendarView />}
            </motion.div>
          </AnimatePresence>
        </Stagger>
      </div>

      <CampaignPicker open={picking} onClose={() => setPicking(false)} />
    </div>
  )
}

function Tab({ icon: Icon, label, n }: { icon: typeof PenLine; label: string; n?: number }) {
  return (
    <>
      <Icon className="size-3.5" strokeWidth={1.75} />
      {label}
      {!!n && <span className="font-mono text-[10px] text-dim">{n}</span>}
    </>
  )
}
