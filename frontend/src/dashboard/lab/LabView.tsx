import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, AudioWaveform, CircleAlert, CloudCheck, Hand, LayoutTemplate, LoaderCircle, Pencil, Play, Sparkles, X, Zap } from 'lucide-react'
import { api, ApiError, type LabCatalog, type LabPayload, type LabPlan, type LabTemplate } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { useRouter } from '../../lib/router'
import { Conversation } from '../assistant/Conversation'
import { useAssistant } from '../assistant/store'
import { useApi, useInvalidate } from '../data'
import { useToast } from '../toast'
import { Btn, Label, Modal, Skeleton, Toggle, inputClass } from '../ui'
import { Canvas, canvasCenter } from './Canvas'
import { TemplateBrowser } from './Gallery'
import { useLeftLab } from './Home'
import { Inspector } from './Inspector'
import { Library } from './Library'
import { costLine } from './look'
import { newNodeId, useLab, type LabSave } from './useLab'

/**
 * A Creative Lab project: the library of nodes (left), the canvas, and the selected node or the
 * assistant (right). The assistant works on this same graph: what it adds and runs shows here.
 */
export function LabView({ id, node }: { id: number; node?: string | null }) {
  const toast = useToast()
  const { navigate } = useRouter()
  const invalidate = useInvalidate()
  const { data: catalog, error: catalogError, setData: setCatalog } = useApi<LabCatalog>('/lab/catalog')
  const lab = useLab(id, toast)
  const [selected, setSelected] = useState<string | null>(node ?? null)
  // The right side: the assistant from the start, a node's settings when one is selected.
  const [side, setSide] = useState<'node' | 'assistant'>(node ? 'node' : 'assistant')
  const [open, setOpen] = useState(true)
  const [control, setControl] = useState(() => {
    try {
      return localStorage.getItem(`lab-control-${id}`) === '1'
    } catch {
      return false
    }
  })
  const [runAll, setRunAll] = useState<LabPlan | null>(null)
  // The templates with their examples: all of them, or one opened.
  const [browse, setBrowse] = useState<{ start: LabTemplate | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const a = useAssistant()
  const data = lab.data

  useEffect(() => {
    if (data) setName(data.project.name)
  }, [data?.project.name])

  // A canvas still without a name asks for one as it opens (once each time), so it isn't lost among the projects
  const [askName, setAskName] = useState(false)
  const asked = useRef<number | null>(null)
  useEffect(() => {
    if (!data || asked.current === id) return
    asked.current = id
    if (!data.project.name.trim() || data.project.name.trim() === UNTITLED) setAskName(true)
  }, [data, id])

  // The assistant is there from the start, and knows which project is open, what's selected, and
  // whether it has control (it builds and runs on its own) to work on the same graph.
  useEffect(() => {
    a.start()
  }, [])
  useEffect(() => {
    if (a.conn === 'online') a.action('lab', { project: id, node: selected, control })
  }, [a.conn, id, selected, control])
  useLeftLab()
  useEffect(() => {
    try {
      localStorage.setItem(`lab-control-${id}`, control ? '1' : '0')
    } catch {
      /* private mode */
    }
  }, [control, id])

  const select = useCallback((nid: string | null) => {
    setSelected(nid)
    setSide(nid ? 'node' : 'assistant')
    if (nid) setOpen(true)
  }, [])

  const add = useCallback(
    (type: string, x?: number, y?: number) => {
      if (!data || !catalog) return
      const at = x !== undefined && y !== undefined ? { x, y } : canvasCenter()
      const nid = newNodeId(data.canvas, catalog.nodes[type])
      void lab.ops([{ op: 'add', node: { id: nid, type, x: Math.round(at.x), y: Math.round(at.y) } }])
      select(nid)
    },
    [data, catalog, lab, select],
  )

  const insert = useCallback(
    (t: LabTemplate) => {
      if (!data) return
      const at = canvasCenter()
      const bottom = data.canvas.nodes.length ? Math.max(...data.canvas.nodes.map((n) => n.y)) + 420 : at.y
      void lab.ops([{ op: 'insert', graph: t.graph, x: Math.round(data.canvas.nodes.length ? Math.min(...data.canvas.nodes.map((n) => n.x)) : at.x), y: Math.round(bottom) }]).then((r) => r && toast(`${t.name}: added. Fill in the nodes, then run them.`))
    },
    [data, lab, toast],
  )

  const rename = async (to = name) => {
    if (!data || to === data.project.name) return
    // An emptied name isn't saved: the one it has comes back.
    if (!to.trim()) return setName(data.project.name)
    setName(to.trim())
    try {
      await api(`/projects/${id}`, { method: 'PATCH', body: { name: to.trim() } })
      invalidate()
    } catch (e) {
      // Back to the name it really has.
      setName(data.project.name)
      toast(e instanceof ApiError ? e.message : 'The name couldn’t be saved.')
    }
  }

  // The canvas can't be drawn without the catalog either: say so rather than load forever.
  const failed = lab.failed ?? (!catalog && catalogError ? catalogError.message || 'The nodes couldn’t be loaded.' : null)
  if (failed) {
    return (
      <div className="grid h-[60vh] place-items-center text-center">
        <div>
          <p className="text-[15px] font-medium">{failed}</p>
          <Btn className="mt-4" icon={ArrowLeft} onClick={() => navigate('/dashboard/studio')}>
            All projects
          </Btn>
        </div>
      </div>
    )
  }
  if (!data || !catalog) return <Skeleton className="h-[calc(100dvh-140px)] rounded-xl" />

  const running = Object.values(data.nodes).filter((n) => n.status === 'running' || n.status === 'queued').length
  const untitled = !name.trim() || name.trim() === UNTITLED

  return (
    <div className="-mx-4 -mt-2 flex h-[calc(100dvh-88px)] flex-col overflow-hidden rounded-xl border border-line bg-panel md:mx-0">
      {/* Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Btn size="sm" variant="subtle" icon={ArrowLeft} onClick={() => navigate('/dashboard/studio')} aria-label="All projects" />
        {/* The name, plainly editable: a project not named yet asks for one, so it's easy to find again */}
        <label className={cn('group flex min-w-0 max-w-[300px] flex-1 items-center gap-1.5 rounded-md border px-2 py-1 transition-colors focus-within:border-accent/60 focus-within:bg-white/[0.03]', untitled ? 'border-dashed border-accent/50' : 'border-transparent hover:border-line-2')} title="Rename the project">
          <input value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => untitled && e.target.select()} onBlur={() => void rename()} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} placeholder="Name this canvas" aria-label="Project name" className="min-w-0 flex-1 bg-transparent text-[14px] font-medium outline-none placeholder:text-dim" />
          <Pencil className={cn('size-3 shrink-0 transition-colors', untitled ? 'text-accent-soft' : 'text-dim group-hover:text-fg')} />
        </label>
        {untitled && <span className="hidden text-[11px] text-accent-soft md:inline">Name it to find it again</span>}
        <SaveStatus save={lab.save} />
        {running > 0 && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-accent-soft">
            <LoaderCircle className="size-3.5 animate-spin" />
            {running} running
          </span>
        )}
        {!catalog.engine.up && <span className="hidden text-[11.5px] text-warn lg:inline" title={catalog.engine.error ?? ''}>The pod’s models are off: {catalog.engine.error}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <label className="mr-1 flex items-center gap-2 text-[12px] text-muted" title="Off: nothing runs until you press Run. On: nodes you’ve run once run again by themselves when what they use changes (quick, free ones only).">
            Keep up to date
            <Toggle on={!!data.canvas.auto} onChange={(on) => void lab.ops([{ op: 'auto', on }])} label="Keep the nodes you’ve run up to date" />
          </label>
          <Btn size="sm" icon={Play} onClick={() => void lab.runAll(false).then(setRunAll).catch((e) => toast(e instanceof ApiError ? e.message : 'That couldn’t be worked out.'))}>
            Run all
          </Btn>
          <Btn size="sm" icon={LayoutTemplate} onClick={() => setSaving(true)}>
            Save as template
          </Btn>
          <Btn size="sm" variant={open && side === 'assistant' ? 'primary' : 'ghost'} icon={AudioWaveform} onClick={() => {
            if (open && side === 'assistant') setOpen(false)
            else {
              setOpen(true)
              setSide('assistant')
            }
          }}>
            Assistant
          </Btn>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <Library catalog={catalog} onAdd={(t) => add(t)} onTemplate={insert} onPreview={(t) => setBrowse({ start: t })} className="hidden w-[232px] shrink-0 border-r border-line md:flex" />
        <Canvas lab={lab} catalog={catalog} selected={selected} onSelect={select} onAdd={(t, x, y) => add(t, x, y)} onOpen={(nid) => select(nid)} onTemplate={(t) => setBrowse({ start: t })} className="min-w-0 flex-1" />
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="side"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease }}
              className="min-h-0 shrink-0 overflow-hidden border-l border-line bg-panel"
            >
              <div className="flex h-full w-[380px] flex-col">
                {/* Assistant | the selected node */}
                <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
                  <button type="button" onClick={() => setSide('assistant')} className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors', side === 'assistant' ? 'bg-white/[0.08] text-fg' : 'text-dim hover:text-fg')}>
                    <Sparkles className="size-3.5" /> Assistant
                  </button>
                  {selected && (
                    <button type="button" onClick={() => setSide('node')} className={cn('min-w-0 truncate rounded-md px-2.5 py-1.5 text-[12px] transition-colors', side === 'node' ? 'bg-white/[0.08] text-fg' : 'text-dim hover:text-fg')}>
                      {data.canvas.nodes.find((n) => n.id === selected)?.label || catalog.nodes[data.canvas.nodes.find((n) => n.id === selected)?.type ?? '']?.label || selected}
                    </button>
                  )}
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close the panel" className="ml-auto grid size-7 place-items-center rounded-md text-dim hover:text-fg">
                    <X className="size-4" />
                  </button>
                </div>
                {side === 'assistant' || !selected ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="space-y-2 border-b border-line px-4 py-3">
                      {/* On or off at a glance: tinted with a badge when it has control, plain when it asks first */}
                      <div className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-300', control ? 'border-accent/50 bg-accent/10' : 'border-line bg-white/[0.02]')}>
                        <span className={cn('grid size-7 shrink-0 place-items-center rounded-md transition-colors duration-300', control ? 'bg-accent/20 text-accent-soft' : 'bg-white/[0.05] text-dim')}>
                          {control ? <Zap className="size-3.5" /> : <Hand className="size-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-[12.5px] font-medium">
                            Let it take control
                            <span className={cn('rounded-full px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider', control ? 'bg-accent/20 text-accent-soft' : 'bg-white/[0.06] text-dim')}>{control ? 'On' : 'Off'}</span>
                          </p>
                          <p className="text-[11px] leading-snug text-dim">{control ? 'It builds and runs the nodes itself, slow and paid ones too. Scheduling stays yours.' : 'It builds what you ask, and asks you before running anything slow or paid.'}</p>
                        </div>
                        <Toggle on={control} onChange={setControl} label="Let the assistant take control" />
                      </div>
                      {!data.canvas.nodes.length && <p className="text-[11.5px] leading-snug text-muted">Tell it what to make: “a campaign for our autumn menu, a post and a reel for Instagram”. It starts with the brief.</p>}
                    </div>
                    <Conversation className="min-h-0 flex-1" onImport={() => toast('Open a campaign’s posts from the Campaigns page.')} />
                  </div>
                ) : (
                  <div className="min-h-0 flex-1">
                    <Inspector lab={lab} catalog={catalog} nodeId={selected} onClose={() => select(null)} onSelect={select} />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <RunAll plan={runAll} onClose={() => setRunAll(null)} onRun={async () => {
        try {
          const res = await lab.runAll(true)
          setRunAll(null)
          const errors = Object.values(res.errors ?? {})
          toast(errors.length ? `Started ${res.started?.length ?? 0}. ${errors[0]}` : `Running ${res.started?.length ?? 0} node${res.started?.length === 1 ? '' : 's'}.`)
        } catch (e) {
          toast(e instanceof ApiError ? e.message : 'They couldn’t be started.')
        }
      }} />
      <TemplateBrowser
        open={!!browse}
        start={browse?.start ?? null}
        onClose={() => setBrowse(null)}
        templates={catalog.templates}
        catalog={catalog}
        useLabel="Add to the canvas"
        onUse={(t) => {
          setBrowse(null)
          insert(t)
        }}
        onAsk={(t) => {
          setBrowse(null)
          setOpen(true)
          setSide('assistant')
          void a.say(`Build ${t.name.toLowerCase()} on this canvas, like the template's example: ${t.tagline}`)
        }}
      />
      <NameOnOpen open={askName} onClose={() => setAskName(false)} onName={(n) => {
        setAskName(false)
        void rename(n)
      }} />
      <SaveTemplate open={saving} onClose={() => setSaving(false)} projectId={id} defaultName={data.project.name} onSaved={() => void api<LabCatalog>('/lab/catalog').then(setCatalog).catch(() => {})} />
    </div>
  )
}

function RunAll({ plan, onClose, onRun }: { plan: LabPlan | null; onClose: () => void; onRun: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={!!plan} onClose={onClose} title="Run everything that’s out of date">
      {plan && (
        <div className="space-y-4">
          {plan.nodes.length ? (
            <>
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {plan.nodes.map((n) => (
                  <li key={n.id} className="flex items-center gap-2 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate">{n.label}</span>
                    <span className="shrink-0 text-[11.5px] text-dim">{costLine(n)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[12.5px] text-muted">In all: {costLine(plan)}. Posts aren’t included: saving or scheduling stays yours, on each Post node.</p>
            </>
          ) : (
            <p className="text-[13px] text-muted">Everything is up to date.</p>
          )}
          <div className="flex justify-end gap-2">
            <Btn variant="subtle" onClick={onClose}>
              Cancel
            </Btn>
            {!!plan.nodes.length && (
              <Btn variant="primary" icon={Play} loading={busy} onClick={async () => {
                setBusy(true)
                try {
                  await onRun()
                } finally {
                  setBusy(false)
                }
              }}>
                Run {plan.nodes.length}
              </Btn>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

/** The name FlowAI gives a project made without one (LabController). */
export const UNTITLED = 'Untitled project'

/** Asked as an untitled canvas opens: its name, or later (the name at the top of the canvas stays a click away). */
function NameOnOpen({ open, onClose, onName }: { open: boolean; onClose: () => void; onName: (name: string) => void }) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName('')
  }, [open])
  return (
    <Modal open={open} onClose={onClose} title="Name this canvas">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onName(name)
        }}
        className="space-y-4"
      >
        <div>
          <input autoFocus className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Autumn menu launch" aria-label="Canvas name" />
          <p className="mt-2 text-[11.5px] leading-snug text-dim">It doesn’t have a name yet. Everything on it is saved as you work; a name makes it easy to find with your projects later.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>
            Later
          </Btn>
          <Btn type="submit" variant="primary" disabled={!name.trim()}>
            Save name
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

/** Every change is saved as it's made: this says so, and says when one wasn't. */
function SaveStatus({ save }: { save: LabSave }) {
  if (save.status === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-dim" aria-live="polite">
        <LoaderCircle className="size-3 animate-spin" /> Saving…
      </span>
    )
  }
  if (save.status === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-fail" aria-live="polite" title="The canvas shows what is saved. Do that change again.">
        <CircleAlert className="size-3" /> Last change not saved
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-dim" aria-live="polite" title={save.at ? `Saved at ${new Date(save.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Every change is saved as you make it'}>
      <CloudCheck className="size-3.5 text-ok" /> All changes saved
    </span>
  )
}

function SaveTemplate({ open, onClose, projectId, defaultName, onSaved }: { open: boolean; onClose: () => void; projectId: number; defaultName: string; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setName(defaultName)
  }, [open, defaultName])
  const save = async () => {
    setBusy(true)
    try {
      await api(`/projects/${projectId}/lab/template`, { method: 'POST', body: { name, description } })
      toast('Saved. It’s with the templates now, under Yours.')
      onSaved()
      onClose()
    } catch {
      toast('It couldn’t be saved.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Save as a template">
      <div className="space-y-3">
        <label className="block">
          <Label>Name</Label>
          <input className={cn(inputClass, 'mt-2')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <Label>What it makes</Label>
          <input className={cn(inputClass, 'mt-2')} value={description} placeholder="A weekly tip carousel in our style" onChange={(e) => setDescription(e.target.value)} />
        </label>
        <p className="text-[11.5px] leading-snug text-dim">The nodes, their settings and lines are kept. Files, accounts, phones and YouTube links aren’t: they’re filled in each time.</p>
        <div className="flex justify-end gap-2">
          <Btn variant="subtle" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Save template
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

export type { LabPayload }
