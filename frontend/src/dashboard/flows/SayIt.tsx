import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react'
import { api, ApiError, type Account, type FlowCatalog, type FlowDetail, type FlowGraph } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useTypewriter } from '../../lib/useTypewriter'
import { useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, Kbd } from '../ui'
import { Dictate } from '../sound/Dictate'
import { hueOf, iconOf, ordered, PORT_TONE, summaryOf } from './look'
import { Sketch } from './Sketch'

const EXAMPLES = [
  'Every Friday at 5pm, write a weekend teaser for my Instagram and ask me before it goes out',
  'When a comment turns angry, freeze the account and ping my team on Slack',
  'Watch the Vogue business feed. If a story fits us, draft a reaction post for my review',
  'When a post goes live, wait two days and remind me to check how it did',
  'Every Monday, bring back an old post with a fresh opening line',
]

type Draft = { name: string; description: string; graph: FlowGraph }

/**
 * "Say it": describe an automation in plain words and watch it draw itself as a flow. Nothing
 * is saved until "Keep it".
 */
export function SayIt({ catalog, accounts }: { catalog: FlowCatalog; accounts: Account[] | null }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const [prompt, setPrompt] = useState('')
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [keeping, setKeeping] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [example, setExample] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)

  // The placeholder types out one example after another while the box is empty.
  const idle = !prompt && !focused && !busy
  const { value: typed, done } = useTypewriter(EXAMPLES[example], idle, 28)
  useEffect(() => {
    if (!idle || !done) return
    const t = window.setTimeout(() => setExample((e) => (e + 1) % EXAMPLES.length), 2600)
    return () => window.clearTimeout(t)
  }, [idle, done])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(160, el.scrollHeight)}px`
  }, [prompt])

  const build = async () => {
    if (prompt.trim().length < 8 || busy) return
    setBusy(true)
    setDraft(null)
    try {
      setDraft(await api<Draft>('/flows/compose', { method: 'POST', body: { prompt } }))
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t build that flow.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const keep = async () => {
    if (!draft) return
    setKeeping(true)
    try {
      const flow = await api<FlowDetail>('/flows', { method: 'POST', body: { name: draft.name, description: draft.description, graph: draft.graph } })
      invalidate()
      navigate(`/dashboard/flows?id=${flow.id}`)
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t keep it.', 'error')
      setKeeping(false)
    }
  }

  return (
    <div>
      <div
        className={cn(
          'relative rounded-2xl border bg-panel p-1.5 transition-[border-color,box-shadow] duration-500',
          focused || busy ? 'border-accent-soft/40 shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_14%,transparent),0_30px_80px_-40px_color-mix(in_oklab,var(--color-accent)_70%,transparent)]' : 'border-line-2',
          busy && 'flow-thinking',
        )}
      >
        <div className="flex items-start gap-3 rounded-xl bg-panel-2 px-4 py-3.5">
          <Sparkles className={cn('mt-1 size-[18px] shrink-0 text-accent-soft', busy && 'animate-pulse')} strokeWidth={1.75} />
          <div className="relative min-w-0 flex-1">
            <textarea
              ref={area}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) build()
              }}
              rows={1}
              aria-label="Describe an automation"
              placeholder={focused ? 'When… then… — say it the way you’d tell a colleague.' : ''}
              disabled={busy}
              className="block min-h-[3.3em] w-full resize-none bg-transparent text-[16px] leading-relaxed tracking-[-0.01em] outline-none placeholder:text-dim disabled:opacity-70 sm:min-h-0 md:text-[17px]"
            />
            {idle && (
              <span aria-hidden className="pointer-events-none absolute inset-0 line-clamp-2 text-[16px] leading-relaxed tracking-[-0.01em] text-dim sm:line-clamp-1 md:text-[17px]">
                {typed}
                <span className="ml-px inline-block h-[1.05em] w-px translate-y-[3px] animate-blink bg-dim" />
              </span>
            )}
          </div>
          {!busy && <Dictate iconOnly label="Say it out loud" onText={(t) => setPrompt((p) => (p.trim() ? `${p.trim()} ${t}` : t))} className="mt-1 h-8 px-2" />}
          <Btn variant="primary" icon={busy ? undefined : ArrowRight} loading={busy} disabled={prompt.trim().length < 8} onClick={build} className="mt-0.5">
            {busy ? 'Drawing…' : 'Build it'}
          </Btn>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1.5 pt-2 text-[11px] text-dim">
          <span>Say what starts it and what should happen — or press the mic and say it.</span>
          <span className="hidden sm:inline">
            <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to build
          </span>
          <span className="ml-auto">A person approves anything it schedules. Always.</span>
        </div>
      </div>

      <AnimatePresence>
        {busy && (
          <motion.p key="busy" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
            <LoaderCircle className="size-3.5 animate-spin text-accent-soft" /> Reading what you want, picking the steps, joining them up…
          </motion.p>
        )}
        {draft && (
          <motion.div
            key="draft"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.6, ease }}
            className="mt-4 overflow-hidden rounded-2xl border border-line-2 bg-panel"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-3 pt-4">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent-soft">Drawn from your words</p>
                <p className="mt-1 text-[18px] font-medium tracking-[-0.02em]">{draft.name}</p>
                {draft.description && <p className="mt-0.5 max-w-[70ch] text-[13px] leading-snug text-muted">{draft.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Btn variant="subtle" size="sm" icon={X} onClick={() => setDraft(null)}>
                  Discard
                </Btn>
                <Btn size="sm" icon={RotateCcw} onClick={build}>
                  Again
                </Btn>
                <Btn variant="primary" size="sm" icon={ArrowRight} loading={keeping} onClick={keep}>
                  Keep it
                </Btn>
              </div>
            </div>
            <div className="border-t border-line bg-[radial-gradient(90%_140%_at_0%_0%,color-mix(in_oklab,var(--color-accent)_9%,transparent),transparent_70%)] px-5 py-6">
              <Sketch key={draft.name + draft.graph.nodes.length} graph={draft.graph} height={110} live />
            </div>
            <ol className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
              {ordered(draft.graph).map(({ node, port }, i) => {
                const Icon = iconOf(node.type)
                const hue = hueOf(node.type)
                return (
                  <motion.li
                    key={node.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, ease, delay: 0.3 + i * 0.09 }}
                    className="flex items-start gap-3 bg-panel px-5 py-3.5"
                  >
                    <span className="font-mono text-[10px] tabular-nums text-dim">{String(i + 1).padStart(2, '0')}</span>
                    <Icon className="mt-0.5 size-4 shrink-0" style={{ color: hue }} strokeWidth={1.75} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">
                        {catalog.nodes[node.type]?.label}
                        {port && port !== 'next' && <span className="ml-2 font-mono text-[9.5px] uppercase tracking-[0.12em]" style={{ color: PORT_TONE[port] }}>if {port}</span>}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-dim">{summaryOf(node, accounts)}</span>
                    </span>
                  </motion.li>
                )
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
