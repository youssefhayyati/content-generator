import { useState } from 'react'
import { api, ApiError, type LabCatalog, type LabPayload, type LabTemplate } from '../../lib/api'
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy, Wand2 } from 'lucide-react'
import { PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { CASES, GROUPS, KIND_LABEL, MAKE_LABEL, makePath, VOICE_LABEL, type Case, type Group, type Voice } from '../../showcase/cases'
import { Clip, FlowMap, monogram, Picture, PostText, platformName } from '../../showcase/pieces'
import { Stage } from '../../showcase/stage'
import { useApi } from '../data'
import { TemplateGrid, TemplateSheet } from '../lab/Gallery'
import { useToast } from '../toast'
import { Btn, Label, Modal, PageHeader, Segmented, Stagger } from '../ui'
import { INSPIRE_VIEWS } from '../nav'
import { PageSwitch } from '../PageSwitch'

const pad = (n: number) => String(n).padStart(2, '0')
/** The models a case was made with, once each, in the order they worked. */
const modelsOf = (c: Case) => [...new Set(c.made.map((m) => m.model))]

/** /dashboard/showcase: what FlowAI made for demo brands, how, and a way to make one like it. */
export default function Showcase() {
  const [group, setGroup] = useState<Group | 'all'>('all')
  // The case stays in place while the sheet closes, so it can animate out.
  const [current, setCurrent] = useState<Case>(CASES[0])
  const [open, setOpen] = useState(false)
  const list = group === 'all' ? CASES : CASES.filter((c) => c.group === group)
  const step = (by: number) => setCurrent((c) => CASES[(CASES.indexOf(c) + by + CASES.length) % CASES.length])

  return (
    <div>
      <PageHeader
        title={
          <>
            Made with <Serif>FlowAI.</Serif>
          </>
        }
        sub="Real output for demo brands: posts written in each brand’s voice, pictures, reels, a flow and a launch plan. Open one to see exactly how it was made, then make one like it."
        actions={
          <>
            <PageSwitch id="inspire-view" label="Inspire view" views={INSPIRE_VIEWS} />
            <a
              href="/showcase"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-2 px-3.5 text-[12.5px] font-medium text-fg transition-colors hover:border-white/25 hover:bg-white/[0.04]"
            >
              Public page
              <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
            </a>
          </>
        }
      />

      <Stagger i={0} className="no-scrollbar -mx-4 mt-10 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Segmented
          id="showcase-group"
          label="Show"
          options={GROUPS.map((g) => ({ value: g.id, label: `${g.label} ${g.id === 'all' ? CASES.length : CASES.filter((c) => c.group === g.id).length}` }))}
          value={group}
          onChange={setGroup}
          className="w-fit"
        />
      </Stagger>

      <Stagger i={1} className="mt-5">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.map((c) => (
            <li key={c.id}>
              <CaseCard
                c={c}
                onOpen={() => {
                  setCurrent(c)
                  setOpen(true)
                }}
              />
            </li>
          ))}
        </ul>
      </Stagger>

      <CaseModal c={current} open={open} onClose={() => setOpen(false)} onStep={step} />

      <LabMade />
    </div>
  )
}

/** Creative Lab's templates, each shown by an example made with it: open one, then start a project from it. */
function LabMade() {
  const { navigate } = useRouter()
  const toast = useToast()
  const { data: catalog } = useApi<LabCatalog>('/lab/catalog')
  const [current, setCurrent] = useState<LabTemplate | null>(null)
  const [open, setOpen] = useState(false)
  const templates = catalog?.templates.filter((t) => !t.mine) ?? []
  if (!templates.length) return null
  return (
    <Stagger i={2} className="mt-16">
      <h2 className="text-[22px] font-medium tracking-[-0.02em]">
        Made in <Serif>Creative Lab.</Serif>
      </h2>
      <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-muted">Every template on the canvas, shown by an example made with it, on the GPU pod’s models, for the same demo brands. Open one to see what it was given, the steps it ran and how it came out, then start with it.</p>
      <TemplateGrid templates={templates} className="mt-5" onOpen={(t) => {
        setCurrent(t)
        setOpen(true)
      }} />
      <TemplateSheet
        t={current}
        list={templates}
        catalog={catalog}
        open={open}
        onClose={() => setOpen(false)}
        onStep={setCurrent}
        useLabel="Start with this template"
        onUse={(t) => {
          api<LabPayload>('/lab/projects', { method: 'POST', body: { template: t.key, name: t.name } })
            .then((p) => navigate(`/dashboard/studio?project=${p.project.id}`))
            .catch((e) => toast(e instanceof ApiError ? e.message : 'The project couldn’t be made.'))
        }}
      />
    </Stagger>
  )
}

function CaseCard({ c, onOpen }: { c: Case; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-panel text-left transition-[border-color,box-shadow] duration-300 hover:border-line-2 hover:shadow-[0_20px_60px_-30px_rgb(0_0_0_/_0.9)]"
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden bg-panel-3">
        <Thumb c={c} />
        <span className="absolute left-2.5 top-2.5 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white/90 backdrop-blur">
          {KIND_LABEL[c.kind]}
        </span>
      </span>
      <span className="flex flex-1 flex-col p-3.5">
        <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
          <span className="truncate">{c.brand.name}</span>
          <span>·</span>
          <span className="truncate">{c.brand.trade}</span>
          <span className="ml-auto flex shrink-0 gap-1">
            {c.versions?.map((v) => <PlatformIcon key={v.platform} id={v.platform} className="size-3" />)}
          </span>
        </span>
        <span className="mt-1 text-[14px] font-medium leading-snug">{c.title}</span>
        <span className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{c.brief}</span>
        <span className="mt-auto flex flex-wrap gap-1 pt-3">
          {modelsOf(c).map((m) => (
            <span key={m} className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-dim">
              {m}
            </span>
          ))}
        </span>
      </span>
    </button>
  )
}

/** The card's picture: the shot, the clip playing, the flow drawn small, or the post's opening lines. */
function Thumb({ c }: { c: Case }) {
  const shot = c.shots?.[0]
  if (c.video) return <Clip c={c} className="size-full object-cover" />
  // The flow at a size its labels can be read at: the first steps show, the rest fade out below.
  if (c.flow)
    return (
      <span className="flex size-full justify-center overflow-hidden pt-9">
        <span className="block w-[290px] shrink-0">
          <FlowMap flow={c.flow} compact />
        </span>
        <span className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-panel-3 to-transparent" />
      </span>
    )
  if (shot) return <Picture shot={shot} size="sm" className="size-full object-cover transition-transform duration-700 ease-expo group-hover:scale-[1.03]" />
  const v = c.versions?.[0]
  return (
    <span className="block size-full px-4 pb-4 pt-10" style={{ ['--tag' as string]: 'var(--color-accent-soft)' }}>
      {v && <PostText text={v.text} className="line-clamp-6 text-[12.5px] leading-snug text-fg/85" />}
      <span className="absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-panel-3 to-transparent" />
    </span>
  )
}

function CaseModal({ c, open, onClose, onStep }: { c: Case; open: boolean; onClose: () => void; onStep: (by: number) => void }) {
  const { navigate } = useRouter()
  const [version, setVersion] = useState(0)
  const [copied, setCopied] = useState(false)
  const v = c.versions?.[version]
  const index = CASES.indexOf(c)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.prompt ?? c.brief)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* Clipboard refused: nothing to do. */
    }
  }
  const go = (by: number) => {
    setVersion(0)
    onStep(by)
  }

  return (
    <Modal open={open} onClose={onClose} title={`${pad(index + 1)} · ${c.title}`} full>
      <div className="grid gap-5 lg:h-full lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
        <div className="relative flex min-h-[50vh] items-center justify-center overflow-hidden rounded-lg bg-black p-4 lg:min-h-0 lg:p-6">
          <Stage key={c.id + version} c={c} version={version} tone="panel" />
        </div>

        <div className="flex flex-col lg:min-h-0">
          {/* Keyed by case, so stepping to the next one starts at the top again. */}
          <div key={c.id} className="flex flex-1 flex-col gap-5 pb-5 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <div>
              <p className="flex items-center gap-2 text-[12.5px] text-muted">
                <span className="grid size-6 place-items-center rounded-full bg-fg text-[9px] font-semibold text-ink">{monogram(c.brand.name)}</span>
                {c.brand.name} · {c.brand.trade}
                <span className="rounded border border-line px-1.5 py-px text-[10.5px] text-dim">Demo brand</span>
              </p>
              <h2 className="mt-3 text-[20px] font-medium leading-tight tracking-[-0.02em]">{c.title}</h2>
            </div>

            <section>
              <Label>Brief</Label>
              <p className="mt-2 border-l-2 border-accent/50 pl-3 text-[13.5px] leading-relaxed text-fg">{c.brief}</p>
              {c.fields && (
                <dl className="mt-3 space-y-2">
                  {c.fields.map(([k, val]) => (
                    <div key={k} className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 text-[12.5px] leading-snug">
                      <dt className="text-dim">{k}</dt>
                      <dd className="text-muted">{val}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            {/* Only where words were written in it: posts, captions and the campaign plan. */}
            {c.brand.voice && (c.versions || c.plan) && <VoiceBlock voice={c.brand.voice} />}

            {c.prompt && (
              <section>
                <Label>{c.video ? 'Clip prompt' : 'Picture prompt'}</Label>
                <p className="mt-2 rounded-md border border-line bg-white/[0.02] p-2.5 font-mono text-[11.5px] leading-relaxed text-muted">{c.prompt}</p>
              </section>
            )}

            {c.versions && (
              <section>
                <Label>{c.versions.length > 1 ? `${c.versions.length} versions` : 'Caption'}</Label>
                {c.versions.length > 1 && (
                  <Segmented
                    id="showcase-version"
                    label="Version"
                    options={c.versions.map((x, j) => ({ value: j, label: platformName(x) }))}
                    value={version}
                    onChange={setVersion}
                    className="mt-2 w-fit"
                  />
                )}
                {v && c.kind !== 'post' && (
                  <div className="mt-2 rounded-md border border-line bg-white/[0.02] p-3" style={{ ['--tag' as string]: 'var(--color-accent-soft)' }}>
                    <PostText text={v.text} className="text-[12.5px] leading-relaxed text-fg/90" />
                  </div>
                )}
              </section>
            )}

            <section>
              <Label>How it was made</Label>
              <ol className="mt-2 space-y-2">
                {c.made.map((m, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-[12.5px] leading-snug">
                    <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[9px] text-dim">{j + 1}</span>
                    <span className="min-w-0 flex-1">{m.did}</span>
                    <span className="shrink-0 rounded border border-line px-1.5 py-px font-mono text-[10px] text-dim">{m.model}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="shrink-0 space-y-2 border-t border-line pt-4">
            <div className="flex gap-2">
              <Btn variant="primary" icon={Wand2} onClick={() => navigate(makePath(c.make))} className="flex-1">
                {MAKE_LABEL[c.make.tool]}
              </Btn>
              <Btn icon={copied ? Check : Copy} onClick={copy}>
                {copied ? 'Copied' : c.prompt ? 'Copy prompt' : 'Copy brief'}
              </Btn>
            </div>
            <div className="flex items-center justify-between text-[12px] text-dim">
              <button type="button" onClick={() => go(-1)} className="flex items-center gap-1 transition-colors hover:text-fg">
                <ArrowLeft className="size-3.5" /> Previous
              </button>
              <button type="button" onClick={() => go(1)} className={cn('flex items-center gap-1 transition-colors hover:text-fg')}>
                Next <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** The brand's voice, as its account profile states it: what the writer was told before writing. */
export function VoiceBlock({ voice, className }: { voice: Voice; className?: string }) {
  return (
    <section className={className}>
      <Label>Voice</Label>
      <dl className="mt-2 space-y-2">
        {(Object.keys(VOICE_LABEL) as Array<keyof Voice>)
          .filter((k) => voice[k])
          .map((k) => (
            <div key={k} className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 text-[12.5px] leading-snug">
              <dt className="text-dim">{VOICE_LABEL[k]}</dt>
              <dd className="text-muted">{voice[k]}</dd>
            </div>
          ))}
      </dl>
    </section>
  )
}
