import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, History, MoreHorizontal, Play, RotateCcw, Trash2 } from 'lucide-react'
import { api, ApiError, type Account, type FlowCatalog, type FlowDetail, type FlowGraph, type FlowNode, type FlowRun } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { useApi, useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, Label, Menu, Toggle } from '../ui'
import { Board } from './Board'
import { defaults, Inspector } from './Inspector'
import { COLUMN, GROUP_HUE, hueOf, iconOf, NODE_H, NODE_W, ROW, uid } from './look'
import { RunDetail, RunList } from './Runs'

/** How long each step of a replay takes to light up. */
const STEP_MS = 420

/**
 * One flow, on its canvas. The palette adds steps (joined to the selected one), the panel on
 * the right edits the selected step or shows the runs, and Run tries the flow with real data
 * while the canvas lights up step by step.
 */
export function FlowEditor({ id, runParam, born }: { id: number; runParam: number | null; born: boolean }) {
  const { navigate } = useRouter()
  const toast = useToast()
  const invalidate = useInvalidate()
  const { data: catalog } = useApi<FlowCatalog>('/flows/catalog')
  const { data: accounts } = useApi<Account[]>('/accounts')
  const [flow, setFlow] = useState<FlowDetail | null>(null)
  const [graph, setGraph] = useState<FlowGraph | null>(null)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState<'saved' | 'saving' | 'unsaved' | 'invalid'>('saved')
  const [selected, setSelected] = useState<string | null>(null)
  const [runId, setRunId] = useState<number | null>(runParam)
  const [run, setRun] = useState<FlowRun | null>(null)
  const [shown, setShown] = useState(0)
  const [starting, setStarting] = useState(false)
  const loaded = useRef(false)
  // The run the canvas is replaying, so a new one starts its replay from the top.
  const followed = useRef<number | null>(null)
  const pendingSave = useRef<Promise<unknown> | null>(null)

  const refresh = useCallback(
    () =>
      api<FlowDetail>(`/flows/${id}`).then((f) => {
        setFlow(f)
        return f
      }),
    [id],
  )

  useEffect(() => {
    refresh()
      .then((f) => {
        setGraph(f.graph)
        setName(f.name)
        if (!runParam && f.runs[0] && ['running', 'waiting', 'approval'].includes(f.runs[0].status)) setRunId(f.runs[0].id)
      })
      .catch(() => {
        toast('That flow doesn’t exist any more.', 'error')
        navigate('/dashboard/flows', { replace: true })
      })
    // Once per flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  /* -------------------------------------------------------------- */
  /* Saving                                                          */
  /* -------------------------------------------------------------- */

  const save = useCallback(async () => {
    if (!graph) return
    setSaved('saving')
    const p = api<FlowDetail>(`/flows/${id}`, { method: 'PATCH', body: { graph, name: name.trim() || 'Untitled flow' } })
      .then((f) => {
        setFlow((old) => (old ? { ...f, runs: old.runs } : f))
        setSaved('saved')
      })
      .catch((e) => {
        setSaved('invalid')
        if (e instanceof ApiError) toast(Object.values(e.errors)[0]?.[0] ?? e.message, 'error')
      })
    pendingSave.current = p
    return p
  }, [graph, name, id, toast])

  // A moment after the last change.
  useEffect(() => {
    if (!graph) return
    if (!loaded.current) {
      loaded.current = true
      return
    }
    setSaved('unsaved')
    const t = window.setTimeout(save, 700)
    return () => window.clearTimeout(t)
    // `save` changes with graph and name, which is what this watches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, name])

  const flush = async () => {
    if (saved === 'unsaved') await save()
    else if (pendingSave.current) await pendingSave.current
  }

  const setEnabled = async (enabled: boolean) => {
    await flush()
    try {
      const f = await api<FlowDetail>(`/flows/${id}`, { method: 'PATCH', body: { enabled } })
      setFlow((old) => (old ? { ...f, runs: old.runs } : f))
      invalidate()
      toast(enabled ? `“${f.name}” is on. ${f.trigger === 'trigger.manual' ? 'It runs when you press Run.' : `It starts ${f.trigger_label.toLowerCase().startsWith('every') ? f.trigger_label.toLowerCase() : `when: ${f.trigger_label.toLowerCase()}`}.`}` : `“${f.name}” is off.`)
    } catch (e) {
      toast(e instanceof ApiError ? (Object.values(e.errors)[0]?.[0] ?? e.message) : 'Couldn’t switch it.', 'error')
    }
  }

  /* -------------------------------------------------------------- */
  /* Running and replaying                                           */
  /* -------------------------------------------------------------- */

  const runNow = async () => {
    setStarting(true)
    try {
      await flush()
      const r = await api<FlowRun>(`/flows/${id}/run`, { method: 'POST' })
      setSelected(null)
      followed.current = r.id
      setShown(0)
      setRun(r)
      setRunId(r.id)
      refresh()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t start it.', 'error')
    } finally {
      setStarting(false)
    }
  }

  // Follow the selected run: quickly while it works, slowly while it waits.
  useEffect(() => {
    if (!runId) {
      setRun(null)
      return
    }
    let cancelled = false
    let timer = 0
    const tick = async () => {
      try {
        const r = await api<FlowRun>(`/flow-runs/${runId}`)
        if (cancelled) return
        if (followed.current !== r.id) {
          followed.current = r.id
          setShown(0)
        }
        setRun(r)
        const wait = r.status === 'running' ? 900 : r.status === 'waiting' || r.status === 'approval' ? 4000 : 0
        if (wait) timer = window.setTimeout(tick, wait)
        else refresh()
      } catch {
        if (!cancelled) setRunId(null)
      }
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [runId, refresh])

  // Light the steps up one after another, however fast the run really was.
  useEffect(() => {
    if (!run || shown >= run.trail.length) return
    const t = window.setTimeout(() => setShown((s) => s + 1), shown === 0 ? 250 : STEP_MS)
    return () => window.clearTimeout(t)
  }, [run, shown])

  /* -------------------------------------------------------------- */
  /* Editing                                                         */
  /* -------------------------------------------------------------- */

  const change = useCallback((fn: (g: FlowGraph) => FlowGraph) => setGraph((g) => (g ? fn(g) : g)), [])

  const add = (type: string) => {
    if (!graph || !catalog) return
    const from = graph.nodes.find((n) => n.id === selected) ?? null
    // Under the selected step, or under the whole flow; then right until the spot is free.
    const base = from ? { x: from.x, y: from.y + ROW } : { x: Math.min(...graph.nodes.map((n) => n.x)), y: Math.max(...graph.nodes.map((n) => n.y)) + ROW }
    let x = base.x
    while (graph.nodes.some((n) => Math.abs(n.y - base.y) < NODE_H + 30 && Math.abs(n.x - x) < NODE_W + 30)) x += COLUMN
    const node: FlowNode = { id: uid(), type, x, y: base.y, config: defaults(catalog, type) }
    const port = from ? (catalog.nodes[from.type]?.ports[0] ?? 'next') : null
    change((g) => ({
      nodes: [...g.nodes, node],
      edges: from && port && !type.startsWith('trigger.') ? [...g.edges, { from: from.id, to: node.id, port }] : g.edges,
    }))
    setSelected(node.id)
    setRunId(null)
  }

  const remove = (nodeId: string) => {
    change((g) => ({ nodes: g.nodes.filter((n) => n.id !== nodeId), edges: g.edges.filter((e) => e.from !== nodeId && e.to !== nodeId) }))
    setSelected(null)
  }

  const destroy = async () => {
    if (!window.confirm(`Delete “${name}” and its run history?`)) return
    await api(`/flows/${id}`, { method: 'DELETE' })
    invalidate()
    toast('Flow deleted.')
    navigate('/dashboard/flows')
  }

  if (!flow || !graph || !catalog) return <div className="skeleton h-[70dvh] rounded-xl" />

  const node = graph.nodes.find((n) => n.id === selected) ?? null
  const groups = Object.entries(catalog.groups).filter(([g]) => g !== 'trigger') as Array<[keyof typeof GROUP_HUE, string]>

  return (
    <div className="-mx-4 -mt-8 md:-mx-8 md:-mt-10">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel/80 px-4 py-2.5 backdrop-blur md:px-6">
        <Btn variant="subtle" size="sm" icon={ArrowLeft} onClick={() => navigate('/dashboard/flows')} aria-label="All flows" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Flow name"
          className="min-w-[150px] max-w-[320px] flex-1 rounded bg-transparent px-1 text-[14px] font-medium outline-none focus:bg-white/[0.04]"
        />
        <span className={cn('font-mono text-[10px]', saved === 'invalid' ? 'text-fail' : 'text-dim')}>
          {{ saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved', invalid: 'Not saved' }[saved]}
        </span>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim sm:inline">{flow.trigger_label}</span>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <Toggle on={flow.enabled} onChange={setEnabled} label="Flow on" />
            <span className={flow.enabled ? 'text-fg' : ''}>{flow.enabled ? 'On' : 'Off'}</span>
          </label>
          <Btn variant="primary" size="sm" icon={Play} loading={starting} onClick={runNow}>
            Run now
          </Btn>
          <Menu
            trigger={({ toggle }) => <Btn variant="subtle" size="sm" icon={MoreHorizontal} onClick={toggle} aria-label="More" />}
            items={[{ label: 'Delete this flow', icon: Trash2, danger: true, onSelect: destroy }]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:h-[calc(100dvh-7.6rem)] lg:grid-cols-[208px_minmax(0,1fr)_340px]">
        {/* Palette */}
        <aside className="flex gap-4 overflow-x-auto border-b border-line px-4 py-3 lg:block lg:space-y-5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-4" data-lenis-prevent>
          {groups.map(([group, label]) => (
            <div key={group} className="shrink-0">
              <Label className="px-1" >
                <span style={{ color: GROUP_HUE[group] }}>{label}</span>
              </Label>
              <div className="mt-1.5 flex gap-1 lg:block lg:space-y-0.5">
                {Object.entries(catalog.nodes)
                  .filter(([, k]) => k.group === group)
                  .map(([type, k]) => {
                    const Icon = iconOf(type)
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => add(type)}
                        title={k.detail}
                        className="group flex w-max items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-white/[0.05] hover:text-fg lg:w-full"
                      >
                        <Icon className="size-3.5 shrink-0" style={{ color: hueOf(type) }} strokeWidth={1.75} />
                        <span className="truncate">{k.label}</span>
                      </button>
                    )
                  })}
              </div>
            </div>
          ))}
          <p className="hidden px-1 text-[11px] leading-snug text-dim lg:block">
            Select a step first and the new one joins it, below. Drag from a dot on a card’s bottom edge to draw a line.
          </p>
        </aside>

        {/* Canvas */}
        <Board
          graph={graph}
          catalog={catalog}
          accounts={accounts}
          editable={!run}
          selected={selected}
          onSelect={(nodeId) => {
            setSelected(nodeId)
            if (nodeId && run && !['running', 'waiting', 'approval'].includes(run.status)) setRunId(null)
          }}
          onChange={change}
          replay={run ? { run, shown } : null}
          fitKey={run ? `run-${run.id}` : 'edit'}
          born={born}
          className="h-[62dvh] lg:h-full"
        />

        {/* Side panel */}
        <aside className="overflow-y-auto border-t border-line px-4 py-4 lg:border-l lg:border-t-0 lg:px-5" data-lenis-prevent>
          <AnimatePresence mode="wait" initial={false}>
            {node && !run ? (
              <motion.div key={`node-${node.id}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease }}>
                <Inspector
                  node={node}
                  graph={graph}
                  catalog={catalog}
                  accounts={accounts ?? []}
                  onChange={(patch) => change((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === node.id ? { ...n, ...patch } : n)) }))}
                  onRemove={() => remove(node.id)}
                />
              </motion.div>
            ) : run ? (
              <motion.div key={`run-${run.id}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease }}>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <button type="button" onClick={() => setRunId(null)} className="flex items-center gap-1.5 text-[12px] text-dim transition-colors hover:text-fg">
                    <ArrowLeft className="size-3.5" /> Back to editing
                  </button>
                  {shown >= run.trail.length && !['running'].includes(run.status) && (
                    <button type="button" onClick={() => setShown(0)} className="flex items-center gap-1.5 text-[12px] text-dim transition-colors hover:text-fg">
                      <RotateCcw className="size-3.5" /> Replay
                    </button>
                  )}
                </div>
                <RunDetail run={run} catalog={catalog} shown={shown} onChange={(r) => setRun(r)} />
                {run.status === 'approval' || run.status === 'running' ? null : (
                  <RunsBlock flow={flow} runId={runId} onSelect={(r) => setRunId(r)} />
                )}
              </motion.div>
            ) : (
              <motion.div key="flow" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease }}>
                {flow.description && <p className="mb-4 text-[13px] leading-snug text-muted">{flow.description}</p>}
                {flow.problem && <p className="mb-4 rounded-lg border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12px] text-warn">The trigger had a problem: {flow.problem}</p>}
                <p className="mb-5 text-[12px] leading-snug text-dim">
                  Click a step to change it. Nothing goes on the calendar unless you approve it in the run, so an “Ask me first” sits in front of every post.
                </p>
                <RunsBlock flow={flow} runId={runId} onSelect={(r) => setRunId(r)} />
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>
    </div>
  )
}

function RunsBlock({ flow, runId, onSelect }: { flow: FlowDetail; runId: number | null; onSelect: (id: number) => void }) {
  return (
    <div className="mt-6 border-t border-line pt-4 first:mt-0 first:border-t-0 first:pt-0">
      <Label className="flex items-center gap-2">
        <History className="size-3" /> Runs · {flow.runs_count}
      </Label>
      <div className="mt-2">
        <RunList runs={flow.runs} selected={runId} onSelect={onSelect} />
      </div>
    </div>
  )
}
