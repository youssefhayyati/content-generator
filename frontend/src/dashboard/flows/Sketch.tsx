import { motion } from 'framer-motion'
import type { FlowGraph } from '../../lib/api'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'
import { COLUMN, hueOf, iconOf, PORT_TONE, ROW } from './look'

/** Sketch spacing: tighter than the board, so the beads read large on a small card. */
const STEP_X = 112
const STEP_Y = 78
const R = 25

/**
 * A flow in miniature: each step a bead with its glyph, threaded on the line that joins them.
 * The line draws itself in; on hover (or while the flow runs) current travels along it.
 */
export function Sketch({ graph, className, height = 84, live = false }: { graph: FlowGraph; className?: string; height?: number; live?: boolean }) {
  if (!graph.nodes.length) return null
  const minX = Math.min(...graph.nodes.map((n) => n.x))
  const minY = Math.min(...graph.nodes.map((n) => n.y))
  // The board runs top to bottom; a sketch reads left to right, so depth becomes x.
  const at = new Map(graph.nodes.map((n) => [n.id, { cx: ((n.y - minY) / ROW) * STEP_X + R + 6, cy: ((n.x - minX) / COLUMN) * STEP_Y + R + 6 }]))
  const w = Math.max(...[...at.values()].map((p) => p.cx)) + R + 6
  const h = Math.max(...[...at.values()].map((p) => p.cy)) + R + 6

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className={cn('group/sketch w-full overflow-visible', className)} style={{ height }} aria-hidden>
      {graph.edges.map((e, i) => {
        const a = at.get(e.from)
        const b = at.get(e.to)
        if (!a || !b) return null
        const x1 = a.cx + R
        const x2 = b.cx - R
        const dx = Math.max(16, (x2 - x1) * 0.55)
        const d = `M${x1},${a.cy} C${x1 + dx},${a.cy} ${x2 - dx},${b.cy} ${x2},${b.cy}`
        return (
          <g key={`${e.from}-${e.to}-${e.port}`}>
            <motion.path
              d={d}
              fill="none"
              stroke={e.port === 'next' ? 'currentColor' : PORT_TONE[e.port]}
              strokeOpacity={e.port === 'next' ? 0.32 : 0.6}
              strokeWidth={2.5}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, ease, delay: 0.15 + i * 0.09 }}
            />
            <path
              d={d}
              fill="none"
              stroke="var(--color-accent-glow)"
              strokeWidth={2.5}
              strokeDasharray="6 38"
              strokeLinecap="round"
              className={cn('opacity-0 transition-opacity duration-500 [animation:flow-dash_1.3s_linear_infinite] group-hover/sketch:opacity-100', live && 'opacity-100')}
            />
          </g>
        )
      })}
      {graph.nodes.map((n, i) => {
        const p = at.get(n.id)!
        const hue = hueOf(n.type)
        const Icon = iconOf(n.type)
        return (
          <motion.g
            key={n.id}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ transformOrigin: `${p.cx}px ${p.cy}px` }}
            transition={{ duration: 0.5, ease, delay: 0.05 + i * 0.08 }}
          >
            <circle cx={p.cx} cy={p.cy} r={R} fill={hue} fillOpacity={0.13} stroke={hue} strokeOpacity={0.7} strokeWidth={1.5} />
            <Icon x={p.cx - 11} y={p.cy - 11} width={22} height={22} color={hue} strokeWidth={1.75} />
          </motion.g>
        )
      })}
    </svg>
  )
}
