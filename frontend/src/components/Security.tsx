import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, KeyRound } from 'lucide-react'
import { ease } from '../lib/motion'
import { cn } from '../lib/cn'
import { Field, Toggle } from './mock/Mock'
import { DrawnBorder } from './ui/DrawnBorder'
import { PLATFORMS, PlatformIcon, type PlatformId } from './ui/PlatformIcon'
import { LineReveal, Reveal, Serif } from './ui/Reveal'
import { SectionLabel } from './ui/Section'

const POINTS = [
  'Secure account connections',
  'Permission-based integrations',
  'Control what gets published',
  'Review content before publishing',
  'Disconnect platforms anytime',
]

const ACCOUNTS: Array<{ id: PlatformId; handle: string; scopes: string[] }> = [
  { id: 'linkedin', handle: 'Tempo', scopes: ['Publish posts', 'Read profile'] },
  { id: 'instagram', handle: '@tempo.app', scopes: ['Publish media', 'Read insights'] },
  { id: 'x', handle: '@tempo', scopes: ['Post', 'Read profile'] },
  { id: 'tiktok', handle: '@tempoapp', scopes: ['Upload video'] },
]

export function Security() {
  const [connected, setConnected] = useState<Record<string, boolean>>({ linkedin: true, instagram: true, x: true, tiktok: true })
  const [review, setReview] = useState(true)
  const [notify, setNotify] = useState(true)

  return (
    <section id="security" className="relative py-28 md:py-40">
      <div className="container-x grid gap-16 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <SectionLabel index="14">Control</SectionLabel>
          <LineReveal
            className="mt-10 text-[clamp(2.6rem,6vw,6.25rem)] font-medium leading-[0.92] tracking-[-0.05em]"
            lines={['Your content.', <Serif>Your control.</Serif>]}
          />
          <div data-thread="rail" data-side="left">
          <ul className="mt-12 space-y-3.5">
            {POINTS.map((p, i) => (
              <Reveal as="li" key={p} delay={i * 0.05} y={10} className="flex items-center gap-3 text-[16px]">
                <span className="grid size-5 place-items-center rounded-full border border-line-2">
                  <Check className="size-3" strokeWidth={2.5} />
                </span>
                {p}
              </Reveal>
            ))}
          </ul>
          <p className="mt-10 max-w-sm text-[15px] leading-snug text-muted">
            Nothing posts without the permissions you grant. Revoke them from here, or from the platform itself.
          </p>
          </div>
        </div>

        <Reveal y={40} className="lg:col-span-6 lg:col-start-7">
          <div className="relative overflow-hidden rounded-xl border border-white/[0.05] bg-panel">
            <DrawnBorder />
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <p className="text-[13.5px] font-medium">Connected accounts</p>
              <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
                <KeyRound className="size-3.5" /> Scoped access
              </span>
            </div>

            <ul className="divide-y divide-line">
              {ACCOUNTS.map((a) => {
                const on = connected[a.id]
                return (
                  <li key={a.id} className="flex items-center gap-4 px-5 py-4">
                    <span
                      className={cn(
                        'grid size-9 place-items-center rounded-lg border transition-colors duration-500',
                        on ? 'border-line-2 text-fg' : 'border-line text-dim',
                      )}
                    >
                      <PlatformIcon id={a.id} className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px]">
                        {PLATFORMS[a.id].name} <span className="text-dim">{a.handle}</span>
                      </p>
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.p
                          key={on ? 'on' : 'off'}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.25, ease }}
                          className="mt-1 flex flex-wrap gap-1"
                        >
                          {on ? (
                            a.scopes.map((s) => (
                              <span key={s} className="rounded border border-line px-1.5 py-px font-mono text-[10px] text-muted">
                                {s}
                              </span>
                            ))
                          ) : (
                            <span className="font-mono text-[10px] text-dim">Not connected · nothing will post here</span>
                          )}
                        </motion.p>
                      </AnimatePresence>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConnected((c) => ({ ...c, [a.id]: !c[a.id] }))}
                      className={cn(
                        'ml-auto shrink-0 rounded-md border px-3 py-1.5 text-[12px] transition-colors',
                        on ? 'border-line text-muted hover:border-fail/40 hover:text-fail' : 'border-white/25 text-fg hover:bg-white/5',
                      )}
                    >
                      {on ? 'Disconnect' : 'Connect'}
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="space-y-4 border-t border-line bg-white/[0.015] px-5 py-5">
              <Field>Publishing rules</Field>
              <label className="flex items-center justify-between gap-6 text-[13.5px]">
                <span>
                  Review before publishing
                  <span className="mt-0.5 block text-[12px] text-dim">Posts wait in “Needs review” until someone approves them.</span>
                </span>
                <Toggle on={review} onChange={setReview} label="Review before publishing" />
              </label>
              <label className="flex items-center justify-between gap-6 text-[13.5px]">
                <span>
                  Tell me when a post fails
                  <span className="mt-0.5 block text-[12px] text-dim">Email and in-app, with the reason.</span>
                </span>
                <Toggle on={notify} onChange={setNotify} label="Tell me when a post fails" />
              </label>
            </div>
          </div>
          <p className="mt-4 font-mono text-[11px] text-dim">↑ It’s live — try disconnecting something.</p>
        </Reveal>
      </div>
    </section>
  )
}
