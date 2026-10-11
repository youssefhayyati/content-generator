import { useCallback } from 'react'
import type { LabCatalog, LabPayload } from '../../lib/api'
import { useToast } from '../toast'
import type { Lab } from './useLab'

/**
 * Remove nodes at once, with a moment to take it back: Undo puts them back with their lines, under
 * the same ids, so what they made comes back too.
 */
export function useRemove(lab: Lab, catalog: LabCatalog) {
  const toast = useToast()
  return useCallback(
    (ids: string[]) => {
      const data = lab.data as LabPayload | null
      if (!data || !ids.length) return
      const nodes = data.canvas.nodes.filter((n) => ids.includes(n.id))
      const edges = data.canvas.edges.filter((e) => ids.includes(e.from) || ids.includes(e.to))
      if (!nodes.length) return
      const name = nodes.length === 1 ? nodes[0].label || catalog.nodes[nodes[0].type]?.label || 'the node' : `${nodes.length} nodes`
      void lab.ops([{ op: 'remove', ids }]).then((r) => {
        if (!r) return
        let undone = false
        toast(
          <span className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate">Removed {name}.</span>
            <button
              type="button"
              onClick={() => {
                if (undone) return
                undone = true
                void lab.restore(nodes, edges)
              }}
              className="shrink-0 rounded-md bg-white/[0.08] px-2 py-0.5 text-[12px] font-medium text-fg transition-colors hover:bg-white/[0.14]"
            >
              Undo
            </button>
          </span>,
        )
      })
    },
    [lab, catalog, toast],
  )
}
