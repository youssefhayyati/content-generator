import { Fragment, useState } from 'react'
import { motion } from 'framer-motion'
import { CircleAlert, CircleCheck, Cpu, FlaskConical, HardDrive, PlugZap, Wand2 } from 'lucide-react'
import { Serif } from '../../components/ui/Reveal'
import { api, ApiError, type ModelInfo, type Registry } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { fmtRelative, useApi, useInvalidate } from '../data'
import { KIND_ICON, reachLabel } from '../studio/parts'
import { useToast } from '../toast'
import { Btn, Label, PageHeader, Panel, Segmented, Skeleton, Stagger } from '../ui'

type Evals = { tasks: Record<string, string>; results: Record<string, Record<string, { score: number; detail: string | null; output: string | null; at: string }>> }

const PROVIDER_NAME: Record<string, string> = { anthropic: 'Anthropic', gateway: 'Model gateway', groq: 'Groq', openrouter: 'OpenRouter', ollama_cloud: 'Ollama Cloud', ollama: 'Ollama', higgsfield: 'Higgsfield' }

/** /dashboard/models: the registry of local and cloud models, connectors, evals and recipes. */
export default function Models() {
  const { data: registry } = useApi<Registry>('/models')
  const [kind, setKind] = useState<'all' | ModelInfo['kind']>('all')

  return (
    <div>
      <PageHeader
        eyebrow="Models"
        title={
          <>
            Every model, <Serif>one list.</Serif>
          </>
        }
        sub="Local and cloud, how each is reached, what it’s for, and whether it can run. A model is used only once its connector works."
      />

      {!registry ? (
        <Skeleton className="mt-10 h-[420px] rounded-xl" />
      ) : (
        <>
          <Stagger i={0} className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {registry.providers.map((p) => (
              <Connector key={p.id} provider={p} count={registry.models.filter((m) => m.provider === p.id && m.available).length} />
            ))}
          </Stagger>

          <Stagger i={1} className="mt-6">
            <Panel
              title="Registry"
              sub={`${registry.models.filter((m) => m.available).length} of ${registry.models.length} models can run`}
              actions={
                <Segmented
                  id="model-kind"
                  label="Kind"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'text', label: 'Text' },
                    { value: 'image', label: 'Image' },
                    { value: 'video', label: 'Video' },
                    { value: 'voice', label: 'Voice' },
                    { value: 'music', label: 'Music' },
                    { value: 'listen', label: 'Listen' },
                  ]}
                />
              }
              bodyClassName="p-0"
            >
              <ModelTable models={registry.models.filter((m) => kind === 'all' || m.kind === kind)} />
            </Panel>
          </Stagger>

          <Stagger i={2} className="mt-6">
            <EvalsPanel models={registry.models.filter((m) => m.kind === 'text')} />
          </Stagger>

          <Stagger i={3} className="mt-6">
            <RecipesPanel registry={registry} />
          </Stagger>
        </>
      )}
    </div>
  )
}

function Connector({ provider: p, count }: { provider: Registry['providers'][number]; count: number }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [testing, setTesting] = useState(false)
  const test = async () => {
    setTesting(true)
    try {
      const r = await api<{ ok: boolean; message: string }>(`/models/test/${p.id}`, { method: 'POST' })
      toast(r.message, r.ok ? 'success' : 'error')
      invalidate()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The test didn’t run.', 'error')
    } finally {
      setTesting(false)
    }
  }
  const state = !p.configured ? 'off' : p.test?.ok ? 'ok' : p.test ? 'fail' : 'untested'

  return (
    <div className="flex flex-col rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 text-muted">
          {p.local ? <HardDrive className="size-4" strokeWidth={1.75} /> : <PlugZap className="size-4" strokeWidth={1.75} />}
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">{PROVIDER_NAME[p.id]}</p>
          <p className="font-mono text-[10.5px] text-dim">
            {p.local ? 'Local' : 'Cloud'} · {p.reach}
          </p>
        </div>
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10.5px]',
            { ok: 'border-ok/30 text-ok', fail: 'border-fail/30 text-fail', untested: 'border-warn/30 text-warn', off: 'border-white/10 text-dim' }[state],
          )}
        >
          {{ ok: 'Connected', fail: 'Failing', untested: 'Not tested', off: 'Not set up' }[state]}
        </span>
      </div>
      <p className="mt-3 text-[12px] leading-snug text-dim">
        {p.configured ? (p.test ? `${p.test.message} ${p.test.at ? `· ${fmtRelative(p.test.at)}` : ''}` : 'Configured. Test it to start using its models.') : p.setup}
      </p>
      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="font-mono text-[10.5px] text-dim">{count} ready</span>
        <Btn size="sm" icon={PlugZap} onClick={test} loading={testing} disabled={!p.configured}>
          Test
        </Btn>
      </div>
    </div>
  )
}

function ModelTable({ models }: { models: ModelInfo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-[12.5px]">
        <thead>
          <tr className="border-y border-line font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
            <th className="px-5 py-2.5 font-normal">Model</th>
            <th className="px-3 py-2.5 font-normal">Reached through</th>
            <th className="px-3 py-2.5 font-normal">For</th>
            <th className="px-3 py-2.5 font-normal">Eval</th>
            <th className="px-5 py-2.5 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => {
            const Icon = KIND_ICON[m.kind]
            return (
              <motion.tr
                key={m.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: Math.min(i, 20) * 0.015 }}
                className="border-b border-line last:border-b-0"
              >
                <td className="px-5 py-3">
                  <span className="flex items-center gap-2.5">
                    <Icon className="size-3.5 shrink-0 text-dim" strokeWidth={1.75} />
                    <span className={m.available ? 'text-fg' : 'text-muted'}>{m.label}</span>
                  </span>
                  <span className="mt-0.5 block pl-6 font-mono text-[10px] text-dim">{m.id}</span>
                </td>
                <td className="px-3 py-3">
                  <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px]', m.local ? 'border-ok/25 text-ok' : 'border-line-2 text-muted')}>{reachLabel(m)}</span>
                </td>
                <td className="max-w-[260px] px-3 py-3 text-dim">{m.purpose}</td>
                <td className="px-3 py-3 font-mono tabular-nums">{m.score === null ? <span className="text-dim">—</span> : <span className={m.score >= 75 ? 'text-ok' : m.score >= 50 ? 'text-warn' : 'text-fail'}>{m.score}</span>}</td>
                <td className="px-5 py-3">
                  {m.available ? (
                    <span className="flex items-center gap-1.5 text-ok">
                      <CircleCheck className="size-3.5" strokeWidth={2} /> Ready
                    </span>
                  ) : (
                    <span className="flex items-start gap-1.5 text-warn">
                      <CircleAlert className="mt-px size-3.5 shrink-0" strokeWidth={2} />
                      <span className="leading-snug">{m.reason}</span>
                    </span>
                  )}
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EvalsPanel({ models }: { models: ModelInfo[] }) {
  const toast = useToast()
  const { data: evals, setData } = useApi<Evals>('/models/evals')
  const [running, setRunning] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const run = async (model: string) => {
    setRunning(model)
    try {
      await api('/models/evals', { method: 'POST', body: { model } })
      toast('Evaluating. Scores appear here as the tasks finish.')
      // Check back while the suite runs in the background.
      const started = Date.now()
      const t = window.setInterval(async () => {
        const next = await api<Evals>('/models/evals').catch(() => null)
        if (next) setData(next)
        const done = next?.results[model] && Object.values(next.results[model]).every((r) => Date.parse(r.at) >= started - 1000)
        if (done || Date.now() - started > 5 * 60_000) {
          window.clearInterval(t)
          setRunning(null)
        }
      }, 3000)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t start the evals.', 'error')
      setRunning(null)
    }
  }

  const tasks = Object.entries(evals?.tasks ?? {})
  return (
    <Panel title="Evals" sub="Five tasks from the studio’s real work, scored by rule checks and, when Claude is set up, by Claude as a judge." bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[12.5px]">
          <thead>
            <tr className="border-y border-line font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">
              <th className="px-5 py-2.5 font-normal">Model</th>
              {tasks.map(([k, label]) => (
                <th key={k} className="px-3 py-2.5 font-normal">
                  {label}
                </th>
              ))}
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const row = evals?.results[m.id]
              return (
                <Fragment key={m.id}>
                  <tr className="border-b border-line">
                    <td className="px-5 py-3">
                      <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} className={cn('text-left', row ? 'hover:text-accent-soft' : 'cursor-default')} disabled={!row}>
                        {m.label}
                      </button>
                    </td>
                    {tasks.map(([k]) => (
                      <td key={k} className="px-3 py-3 font-mono tabular-nums">
                        {row?.[k] ? <span className={row[k].score >= 75 ? 'text-ok' : row[k].score >= 50 ? 'text-warn' : 'text-fail'}>{row[k].score}</span> : <span className="text-dim">—</span>}
                      </td>
                    ))}
                    <td className="px-5 py-3 text-right">
                      <Btn size="sm" icon={FlaskConical} onClick={() => run(m.id)} loading={running === m.id} disabled={!m.available || (running !== null && running !== m.id)}>
                        {row ? 'Run again' : 'Evaluate'}
                      </Btn>
                    </td>
                  </tr>
                  {open === m.id && row && (
                    <tr className="border-b border-line bg-white/[0.015]">
                      <td colSpan={tasks.length + 2} className="px-5 py-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {tasks.map(([k, label]) =>
                            row[k] ? (
                              <div key={k} className="rounded-lg border border-line p-3">
                                <Label>{label}</Label>
                                <p className="mt-1.5 text-[11.5px] leading-snug text-muted">{row[k].detail}</p>
                                {row[k].output && <p className="mt-2 line-clamp-4 whitespace-pre-wrap border-t border-line pt-2 text-[11.5px] text-dim">{row[k].output}</p>}
                              </div>
                            ) : null,
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function RecipesPanel({ registry }: { registry: Registry }) {
  const { navigate } = useRouter()
  return (
    <Panel
      title="Media recipes"
      sub="Ready-made pipelines: each step’s output feeds the next."
      actions={
        <Btn size="sm" icon={Wand2} onClick={() => navigate('/dashboard/studio?tab=recipes')}>
          Open in the Studio
        </Btn>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Object.entries(registry.recipes).map(([id, r], i) => (
          <motion.div key={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease, delay: i * 0.04 }} className="rounded-lg border border-line p-3.5">
            <p className="text-[13px] font-medium">{r.label}</p>
            <p className="mt-1 text-[12px] leading-snug text-dim">{r.body}</p>
            <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] text-muted">
              {r.needs && <span>image →</span>}
              {r.steps.map((s, j) => (
                <span key={j} className="flex items-center gap-1.5">
                  {j > 0 && '→'}
                  <Cpu className="size-3" strokeWidth={1.75} />
                  {s}
                </span>
              ))}
            </p>
          </motion.div>
        ))}
      </div>
    </Panel>
  )
}
