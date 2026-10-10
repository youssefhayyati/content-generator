import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, LoaderCircle, Megaphone, MessagesSquare, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { CampaignStage, CampaignSummary } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { STAGE_LABEL } from '../campaign/shared'
import { fmtDay, fmtRelative, useApi } from '../data'
import { Btn, inputClass, Modal, Segmented, Skeleton } from '../ui'
import { useAssistant, type ConversationSummary } from './store'

/** The top of the conversation panel: which conversation this is, and the way to the others. */
export function ConversationBar({ onList }: { onList: () => void }) {
  const a = useAssistant()
  const [editing, setEditing] = useState(false)
  const c = a.conversation
  const title = c?.title || 'New conversation'
  const others = a.conversations.filter((x) => x.id !== c?.id).length

  return (
    <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-2">
      <button type="button" onClick={onList} aria-label="All conversations" className="relative grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.05] hover:text-fg">
        <MessagesSquare className="size-4" strokeWidth={1.75} />
        {others > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-white/[0.12] px-1 font-mono text-[8.5px] text-fg">{others}</span>}
      </button>
      {editing && c ? (
        <TitleInput
          value={c.title}
          onDone={(t) => {
            setEditing(false)
            if (t && t !== c.title) a.renameConversation(c.id, t)
          }}
        />
      ) : (
        <button
          type="button"
          onClick={onList}
          onDoubleClick={() => c && a.kept && setEditing(true)}
          title={a.kept ? 'Double-click to rename' : undefined}
          className="min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-white/[0.03]"
        >
          <span className="block truncate text-[12.5px] font-medium">{title}</span>
          <span className="flex items-center gap-1 truncate font-mono text-[10px] text-dim">
            {c?.campaign ? (
              <>
                <Megaphone className="size-2.5 shrink-0 text-accent-soft" />
                <span className="truncate">{c.campaign.name === c.title ? `Campaign · ${STAGE_LABEL[c.campaign.stage as CampaignStage] ?? c.campaign.stage}` : c.campaign.name}</span>
              </>
            ) : a.switching ? (
              'Opening…'
            ) : a.kept ? (
              'Kept · pick it up any time'
            ) : (
              'Not kept'
            )}
          </span>
        </button>
      )}
      {a.switching && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent-soft" />}
      <button
        type="button"
        onClick={() => a.newConversation()}
        disabled={a.conn !== 'online'}
        aria-label="New conversation"
        title="New conversation"
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.05] hover:text-fg disabled:opacity-40"
      >
        <Plus className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}

function TitleInput({ value, onDone, className }: { value: string; onDone: (title: string) => void; className?: string }) {
  const [text, setText] = useState(value)
  const done = useRef(false)
  const finish = (t: string) => {
    if (done.current) return
    done.current = true
    onDone(t.trim())
  }
  return (
    <input
      autoFocus
      value={text}
      maxLength={60}
      aria-label="Conversation name"
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(text)
        if (e.key === 'Escape') finish(value)
      }}
      onFocus={(e) => e.currentTarget.select()}
      className={cn(inputClass, 'h-8 min-w-0 flex-1 px-2 text-[12.5px]', className)}
    />
  )
}

/** Every conversation, over the panel: open one, start one, bring a campaign in, rename, delete. */
export function ConversationList({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: () => void }) {
  const a = useAssistant()
  const [q, setQ] = useState('')
  const refresh = a.refreshConversations

  // Once per opening: onClose is a new function on every render
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const items = a.conversations.filter((c) => {
    const text = `${c.title} ${c.preview} ${c.campaign?.name ?? ''}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
  const unsaved = a.conversation && !a.conversations.some((c) => c.id === a.conversation!.id)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
          transition={{ duration: 0.3, ease }}
          className="absolute inset-0 z-30 flex flex-col bg-panel"
          role="dialog"
          aria-label="Conversations"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-[13.5px] font-medium">Conversations</p>
            <button type="button" onClick={onClose} aria-label="Close the list" className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.05] hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
          <div className="space-y-2.5 border-b border-line p-3">
            <div className="grid grid-cols-2 gap-2">
              <Btn
                size="sm"
                variant="primary"
                icon={Plus}
                disabled={a.conn !== 'online'}
                onClick={() => {
                  a.newConversation()
                  onClose()
                }}
              >
                New
              </Btn>
              <Btn size="sm" icon={Megaphone} disabled={a.conn !== 'online'} onClick={onImport}>
                Open a campaign
              </Btn>
            </div>
            {a.conversations.length > 4 && (
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a conversation" className={cn(inputClass, 'h-8 pl-8 text-[12.5px]')} />
              </label>
            )}
          </div>
          <div data-lenis-prevent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
            {unsaved && !q && (
              <div className="rounded-lg border border-line-2 bg-white/[0.04] px-3 py-2.5">
                <p className="text-[12.5px] font-medium">{a.conversation!.title || 'New conversation'}</p>
                <p className="mt-0.5 font-mono text-[10px] text-dim">On screen · kept once something happens in it</p>
              </div>
            )}
            {items.map((c, i) => (
              <Row
                key={c.id}
                c={c}
                i={i}
                current={c.id === a.conversation?.id}
                onOpen={() => {
                  a.openConversation(c.id)
                  onClose()
                }}
              />
            ))}
            {!a.kept && <p className="px-1 pt-2 text-[11.5px] leading-snug text-dim">Conversations aren’t kept right now: FlowAI didn’t say who you are. Reload the page once it’s back.</p>}
            {a.kept && !a.conversations.length && (
              <p className="px-1 pt-2 text-[11.5px] leading-snug text-dim">Each conversation keeps its drafts, pictures and what was said. They show up here as soon as something happens in them.</p>
            )}
            {a.kept && !!a.conversations.length && !items.length && <p className="px-1 pt-2 text-[11.5px] text-dim">Nothing matches “{q}”.</p>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Row({ c, i, current, onOpen }: { c: ConversationSummary; i: number; current: boolean; onOpen: () => void }) {
  const a = useAssistant()
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState(false)

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease, delay: Math.min(i, 8) * 0.025 }}
      className={cn('group relative rounded-lg border transition-colors', current ? 'border-accent/40 bg-accent/[0.06]' : 'border-line hover:border-line-2 hover:bg-white/[0.02]')}
    >
      <div className="flex items-start gap-1 py-2.5 pl-3 pr-1.5">
        {renaming ? (
          <TitleInput
            value={c.title}
            onDone={(t) => {
              setRenaming(false)
              if (t && t !== c.title) a.renameConversation(c.id, t)
            }}
          />
        ) : (
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[12.5px] font-medium">{c.title}</span>
            {c.preview && <span className="mt-0.5 line-clamp-1 text-[11.5px] leading-snug text-muted">{c.preview}</span>}
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-dim">
              <span>{fmtRelative(c.updated)}</span>
              {c.drafts > 0 && <span>{c.drafts === 1 ? '1 draft' : `${c.drafts} drafts`}</span>}
              {c.pictures > 0 && <span>{c.pictures === 1 ? '1 picture' : `${c.pictures} pictures`}</span>}
              {c.campaign && (
                <span className="flex min-w-0 items-center gap-1 rounded-full border border-accent/25 px-1.5 text-accent-soft">
                  <Megaphone className="size-2.5 shrink-0" />
                  <span className="max-w-[14ch] truncate">{c.campaign.name === c.title ? 'Campaign' : c.campaign.name}</span>
                </span>
              )}
            </span>
          </button>
        )}
        {!renaming && (
          <div className="flex shrink-0 gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            <button type="button" onClick={() => setRenaming(true)} aria-label={`Rename “${c.title}”`} className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[0.06] hover:text-fg">
              <Pencil className="size-3.5" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={() => setConfirm(true)} aria-label={`Delete “${c.title}”`} className="grid size-7 place-items-center rounded-md text-dim hover:bg-fail/10 hover:text-fail">
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {confirm && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }} className="overflow-hidden">
            <div className="border-t border-line px-3 py-2.5">
              <p className="text-[11.5px] leading-snug text-muted">Delete it with its drafts and pictures? What was saved to FlowAI stays.</p>
              <div className="mt-2 flex justify-end gap-2">
                <Btn size="sm" variant="subtle" onClick={() => setConfirm(false)}>
                  Keep
                </Btn>
                <Btn
                  size="sm"
                  variant="danger"
                  icon={Trash2}
                  onClick={() => {
                    setConfirm(false)
                    a.deleteConversation(c.id)
                  }}
                >
                  Delete
                </Btn>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** A FlowAI campaign into the assistant: its posts become drafts, linked to it. */
export function CampaignPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const a = useAssistant()
  const { navigate } = useRouter()
  const { data, loading, error } = useApi<CampaignSummary[]>(open ? '/campaigns' : null)
  const [into, setInto] = useState<'new' | 'this'>('new')
  const busy = !!a.conversation && (Object.keys(a.drafts).length > 0 || !!a.conversation.campaign)

  const pick = (c: CampaignSummary) => {
    onClose()
    if (into === 'this' && busy) a.importCampaign(c.id)
    else a.newConversation(c.id)
  }

  return (
    <Modal open={open} onClose={onClose} title="Open a campaign" className="max-w-lg">
      <p className="text-[12.5px] leading-snug text-muted">
        Its posts become drafts here, one for each account. Change them by voice or by hand; saving one changes it in the campaign, and a changed version waits for your approval again.
      </p>
      {busy && (
        <div className="mt-4">
          <Segmented
            id="campaign-into"
            label="Open it in"
            value={into}
            onChange={setInto}
            options={[
              { value: 'new', label: 'A new conversation' },
              { value: 'this', label: 'This conversation' },
            ]}
          />
        </div>
      )}
      <div data-lenis-prevent className="-mx-1 mt-4 max-h-[min(420px,55dvh)] space-y-1.5 overflow-y-auto px-1">
        {loading && !data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[58px] rounded-lg" />)}
        {error && <p className="text-[12px] text-fail">Couldn’t load your campaigns: {error.message}</p>}
        {data?.length === 0 && (
          <div className="rounded-lg border border-dashed border-line-2 px-4 py-6 text-center">
            <p className="text-[12.5px] text-muted">No campaigns yet.</p>
            <Btn
              size="sm"
              className="mt-3"
              icon={ArrowRight}
              onClick={() => {
                onClose()
                navigate('/dashboard/campaigns')
              }}
            >
              Start one in Campaigns
            </Btn>
          </div>
        )}
        {data?.map((c) => {
          const empty = c.items_count === 0
          return (
            <button
              key={c.id}
              type="button"
              disabled={empty}
              onClick={() => pick(c)}
              className="group flex w-full items-center gap-3 rounded-lg border border-line px-3.5 py-3 text-left transition-colors hover:border-line-2 hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/10 text-accent-soft">
                <Megaphone className="size-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{c.title || 'Untitled campaign'}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[10px] text-dim">
                  <span>{STAGE_LABEL[c.stage]}</span>
                  <span>{empty ? 'no posts yet' : c.items_count === 1 ? '1 post' : `${c.items_count} posts`}</span>
                  {c.period_start && c.period_end && (
                    <span>
                      {fmtDay(c.period_start)} – {fmtDay(c.period_end)}
                    </span>
                  )}
                </span>
              </span>
              {!empty && <ArrowRight className="size-4 shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
