import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type LabCanvas, type LabEdge, type LabNode, type LabNodeKind, type LabPayload, type LabPlan, type LabRun, type LabValue } from '../../lib/api'
import type { Asset } from '../../lib/api'

export type LabOp = Record<string, unknown> & { op: string }

/** A run in a node's history, with what it made. */
export type LabHistoryRun = LabRun & { outputs: Record<string, LabValue>; params: Record<string, unknown>; created_at: string | null }

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'node'

/** A readable id for a new node, like the API makes: "picture-3". */
export function newNodeId(canvas: LabCanvas, kind: LabNodeKind | undefined, taken: string[] = []) {
  const stem = slug(kind?.label ?? 'node')
  const ids = new Set([...canvas.nodes.map((n) => n.id), ...taken])
  for (let n = 1; ; n++) if (!ids.has(`${stem}-${n}`)) return `${stem}-${n}`
}

/** The operations the page can show at once, before the API answers (it always has the last word). */
function applyLocal(canvas: LabCanvas, ops: LabOp[]): LabCanvas {
  let c = canvas
  for (const op of ops) {
    const id = String(op.id ?? '')
    const change = (fn: (n: LabNode) => LabNode) => ({ ...c, nodes: c.nodes.map((n) => (n.id === id ? fn(n) : n)) })
    switch (op.op) {
      case 'add': {
        const node = op.node as LabNode
        if (node?.id && !c.nodes.some((n) => n.id === node.id)) c = { ...c, nodes: [...c.nodes, { params: {}, ...node }] }
        break
      }
      case 'auto':
        c = { ...c, auto: !!op.on }
        break
      case 'move':
        c = change((n) => ({ ...n, x: Number(op.x), y: Number(op.y) }))
        break
      case 'set':
        c = change((n) => {
          const { pin: _p, soft: _s, ...rest } = n
          return { ...rest, params: { ...(n.params ?? {}), ...(op.params as Record<string, unknown>) } }
        })
        break
      case 'label':
        c = change((n) => ({ ...n, label: String(op.label ?? '') || undefined }))
        break
      case 'pin':
        c = change((n) => ({ ...n, pin: op.run ? Number(op.run) : undefined, soft: undefined }))
        break
      case 'remove': {
        const ids = ((op.ids as string[]) ?? [id]).map(String)
        c = { ...c, nodes: c.nodes.filter((n) => !ids.includes(n.id)), edges: c.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)) }
        break
      }
      case 'disconnect':
        c = { ...c, edges: c.edges.filter((e) => !(e.to === op.to && (!op.in || e.in === op.in) && (!op.from || e.from === op.from) && (!op.out || e.out === op.out))) }
        break
      case 'connect':
        if (op.out && op.in) {
          const edge = { from: String(op.from), out: String(op.out), to: String(op.to), in: String(op.in), ...(op.pick != null ? { pick: Number(op.pick) } : {}) } as LabEdge
          c = { ...c, edges: [...c.edges.filter((e) => !(e.from === edge.from && e.out === edge.out && e.to === edge.to && e.in === edge.in)), edge] }
        }
        break
      case 'pick':
        c = {
          ...c,
          edges: c.edges.map((e) => {
            if (e.to !== op.to || (op.in && e.in !== op.in) || (op.from && e.from !== op.from) || (op.out && e.out !== op.out)) return e
            const { pick: _old, ...rest } = e
            return op.pick == null ? rest : { ...rest, pick: Number(op.pick) }
          }),
        }
        break
      case 'view':
        c = { ...c, view: { x: Number(op.x), y: Number(op.y), zoom: Number(op.zoom) } }
        break
    }
  }
  return c
}

/**
 * One open Creative Lab project: its canvas and how each node stands, kept fresh while the page is
 * open (faster while something runs), and the edits, sent as operations. Edits show at once; the API
 * answers with the canvas as it really is, which wins unless more edits are still on their way.
 */
export function useLab(projectId: number, onError: (message: string) => void) {
  const [data, setData] = useState<LabPayload | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const pending = useRef(0)
  const latest = useRef<LabPayload | null>(null)
  latest.current = data
  const paramTimers = useRef(new Map<string, { patch: Record<string, unknown>; timer: number }>())
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const take = useCallback((p: LabPayload, keepCanvas = false) => {
    setData((d) => {
      // Assets come in pieces: keep the ones we have.
      const assets = { ...(d?.assets ?? {}), ...(p.assets ?? {}) }
      const fresh = !keepCanvas && pending.current === 0 && !!p.canvas
      // Settings typed but not sent yet stay on top of what the API has, so a field never jumps back.
      const unsent = [...paramTimers.current.entries()].map(([id, e]) => ({ op: 'set', id, params: e.patch }))
      const canvas = fresh ? (unsent.length ? applyLocal(p.canvas, unsent) : p.canvas) : (d?.canvas ?? p.canvas)
      // The revision goes with the canvas we show, so the next poll brings what we haven't taken.
      return { ...(d ?? p), ...p, canvas, assets, rev: fresh ? p.rev : (d?.rev ?? -1) }
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    api<LabPayload>(`/projects/${projectId}/lab`)
      .then((p) => !cancelled && take(p))
      .catch((e) => !cancelled && setFailed(e instanceof ApiError ? e.message : 'The project couldn’t be opened.'))
    return () => {
      cancelled = true
    }
  }, [projectId, take])

  // Keep fresh: every 1.5 s while something runs, every 5 s otherwise; not while hidden. And at once when the
  // assistant changed or ran this project (store.tsx: lab_changed).
  const busy = !!data && Object.values(data.nodes).some((n) => n.status === 'queued' || n.status === 'running')
  useEffect(() => {
    if (!data) return
    const look = () => {
      if (document.hidden || pending.current > 0) return
      api<Omit<LabPayload, 'canvas' | 'project'> & { canvas: LabCanvas | null }>(`/projects/${projectId}/lab/state`, { query: { rev: latest.current?.rev ?? -1 } })
        .then((s) => take({ ...(latest.current as LabPayload), ...s, canvas: s.canvas ?? (undefined as unknown as LabCanvas) }, !s.canvas))
        .catch(() => {})
    }
    const changed = (e: Event) => (e as CustomEvent<number>).detail === projectId && look()
    const t = window.setInterval(look, busy ? 1500 : 5000)
    window.addEventListener('flowai:lab-changed', changed)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('flowai:lab-changed', changed)
    }
  }, [projectId, busy, !!data, take])

  /** Apply operations: shown at once, then as the API has them. */
  const ops = useCallback(
    async (list: LabOp[]) => {
      if (!list.length) return null
      setData((d) => (d ? { ...d, canvas: applyLocal(d.canvas, list) } : d))
      pending.current++
      try {
        const res = await api<LabPayload>(`/projects/${projectId}/lab/ops`, { method: 'POST', body: { ops: list } })
        pending.current--
        take(res)
        return res
      } catch (e) {
        pending.current--
        const err = e instanceof ApiError ? e : null
        onErrorRef.current(err?.message ?? 'That didn’t work. Try again.')
        // Back to the canvas as it really is.
        api<LabPayload>(`/projects/${projectId}/lab`).then((p) => take(p)).catch(() => {})
        return null
      }
    },
    [projectId, take],
  )

  /** Change a node's settings: shown at once, sent a moment after the last keystroke. */
  const setParams = useCallback(
    (nodeId: string, patch: Record<string, unknown>, now = false) => {
      setData((d) => (d ? { ...d, canvas: applyLocal(d.canvas, [{ op: 'set', id: nodeId, params: patch }]) } : d))
      const timers = paramTimers.current
      const entry = timers.get(nodeId)
      if (entry) window.clearTimeout(entry.timer)
      const merged = { ...(entry?.patch ?? {}), ...patch }
      const send = () => {
        timers.delete(nodeId)
        void ops([{ op: 'set', id: nodeId, params: merged }])
      }
      if (now) send()
      else timers.set(nodeId, { patch: merged, timer: window.setTimeout(send, 700) })
    },
    [ops],
  )

  /** Send any settings still waiting (before running a node, say). */
  const flush = useCallback(async () => {
    const waiting = [...paramTimers.current.entries()]
    paramTimers.current.clear()
    waiting.forEach(([, e]) => window.clearTimeout(e.timer))
    if (waiting.length) await ops(waiting.map(([id, e]) => ({ op: 'set', id, params: e.patch })))
  }, [ops])

  /** Move a node on screen only (while dragging); `ops` with a move commits it. */
  const moveLocal = useCallback((nodeId: string, x: number, y: number) => {
    setData((d) => (d ? { ...d, canvas: { ...d.canvas, nodes: d.canvas.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)) } } : d))
  }, [])

  const run = useCallback(
    async (nodeId: string, upstream = true) => {
      await flush()
      try {
        take(await api<LabPayload>(`/projects/${projectId}/lab/nodes/${encodeURIComponent(nodeId)}/run`, { method: 'POST', body: { upstream } }))
        return true
      } catch (e) {
        onErrorRef.current(e instanceof ApiError ? e.message : 'It couldn’t start.')
        return false
      }
    },
    [projectId, take, flush],
  )

  const stop = useCallback(
    async (nodeId: string) => {
      try {
        take(await api<LabPayload>(`/projects/${projectId}/lab/nodes/${encodeURIComponent(nodeId)}/stop`, { method: 'POST' }))
      } catch (e) {
        onErrorRef.current(e instanceof ApiError ? e.message : 'It couldn’t be stopped.')
      }
    },
    [projectId, take],
  )

  const plan = useCallback((nodeId: string) => api<LabPlan>(`/projects/${projectId}/lab/nodes/${encodeURIComponent(nodeId)}/plan`), [projectId])

  const runAll = useCallback(
    async (confirm: boolean) => {
      await flush()
      const res = await api<LabPlan & Partial<LabPayload> & { started?: string[]; errors?: Record<string, string> }>(`/projects/${projectId}/lab/run-all`, { method: 'POST', body: { confirm } })
      if (confirm && res.canvas) take(res as LabPayload)
      return res
    },
    [projectId, take, flush],
  )

  const history = useCallback(
    (nodeId: string) => api<{ runs: LabHistoryRun[]; assets: Record<number, Asset> }>(`/projects/${projectId}/lab/nodes/${encodeURIComponent(nodeId)}/history`),
    [projectId],
  )

  const refresh = useCallback(() => api<LabPayload>(`/projects/${projectId}/lab`).then((p) => take(p)), [projectId, take])

  /** Put back nodes as they were (an undone remove): the same ids, so their results come back with them. */
  const restore = useCallback(
    (nodes: LabNode[], edges: LabEdge[]) =>
      ops([
        ...nodes.map((n) => ({ op: 'add', node: { id: n.id, type: n.type, x: n.x, y: n.y, params: n.params ?? {}, label: n.label, branch: n.branch } })),
        ...edges.map((e) => ({ op: 'connect', ...e })),
        ...nodes.filter((n) => n.pin && !n.soft).map((n) => ({ op: 'pin', id: n.id, run: n.pin })),
      ]),
    [ops],
  )

  return { data, failed, busy, ops, setParams, flush, moveLocal, run, stop, plan, runAll, history, refresh, restore }
}

export type Lab = ReturnType<typeof useLab>
