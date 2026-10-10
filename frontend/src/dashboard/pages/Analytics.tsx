import { useState } from 'react'
import { Clapperboard, Image, Info, Type } from 'lucide-react'
import { PLATFORMS, PlatformIcon } from '../../components/ui/PlatformIcon'
import { Serif } from '../../components/ui/Reveal'
import { cn } from '../../lib/cn'
import { BarList, Heatmap, LineChart, StatTile } from '../charts'
import { PLATFORM_ORDER, useApi, type Analytics as AnalyticsData } from '../data'
import { CountUp, PageHeader, Panel, Segmented, Skeleton, Stagger } from '../ui'

type Metric = 'created' | 'scheduled' | 'published'

const RANGES = [7, 30, 90] as const
const METRICS: Array<{ value: Metric; label: string; unit: string }> = [
  { value: 'created', label: 'Created', unit: 'Posts created' },
  { value: 'scheduled', label: 'Planned', unit: 'Posts planned' },
  { value: 'published', label: 'Published', unit: 'Posts published' },
]

/** Collapse a daily series into at most `n` buckets for a sparkline. */
function buckets(xs: number[], n = 12) {
  if (xs.length <= n) return xs
  const size = xs.length / n
  return Array.from({ length: n }, (_, i) => {
    const slice = xs.slice(Math.floor(i * size), Math.floor((i + 1) * size))
    return slice.reduce((a, b) => a + b, 0)
  })
}

const short = (date: string) => new Date(`${date}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const long = (date: string) => new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export default function Analytics() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30)
  const [metric, setMetric] = useState<Metric>('scheduled')
  const [lineMode, setLineMode] = useState<'chart' | 'table'>('chart')
  const [heatMode, setHeatMode] = useState<'chart' | 'table'>('chart')
  const { data, loading } = useApi<AnalyticsData>('/analytics', { range })

  const period = `prev. ${range} days`
  const series = (m: Metric) => data?.days.map((d) => d[m]) ?? []

  return (
    <div>
      <PageHeader
        title={
          <>
            What you <Serif>shipped.</Serif>
          </>
        }
        sub="Your output over time: what you wrote, what you planned, and what went out."
      />

      {/* Filters: one row, above everything they scope. */}
      <Stagger i={0} className="mt-10 flex flex-wrap items-center gap-2">
        <Segmented
          id="range"
          label="Date range"
          value={range}
          onChange={setRange}
          options={RANGES.map((r) => ({ value: r, label: `Last ${r} days` }))}
        />
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-dashed border-line-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
          <Info className="size-3" /> Output only · engagement needs connected accounts
        </span>
      </Stagger>

      {!data ? (
        <div className="mt-4 space-y-4">
          <Skeleton className="h-[124px] rounded-xl" />
          <Skeleton className="h-[340px] rounded-xl" />
        </div>
      ) : (
        <div className={cn('mt-4 space-y-4 transition-opacity duration-300', loading && 'opacity-60')}>
          <Stagger i={1}>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
              {METRICS.map((m) => (
                <StatTile
                  key={m.value}
                  label={m.unit}
                  value={<CountUp value={data.totals[m.value].now} />}
                  delta={data.totals[m.value].now - data.totals[m.value].before}
                  trend={buckets(series(m.value))}
                  period={period}
                />
              ))}
              <StatTile label="Drafts waiting" value={<CountUp value={data.totals.drafts} />} />
            </div>
          </Stagger>

          <Stagger i={2}>
            <Panel
              title={`${METRICS.find((m) => m.value === metric)!.unit} per day`}
              sub={`Last ${range} days, in your local time`}
              actions={
                <>
                  <Segmented id="metric" label="Metric" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.value, label: m.label }))} className="hidden sm:flex" />
                  <Segmented
                    id="line-mode"
                    label="View"
                    value={lineMode}
                    onChange={setLineMode}
                    options={[
                      { value: 'chart', label: 'Chart' },
                      { value: 'table', label: 'Table' },
                    ]}
                  />
                </>
              }
            >
              <Segmented id="metric-sm" label="Metric" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.value, label: m.label }))} className="mb-4 w-fit sm:hidden" />
              <LineChart
                mode={lineMode}
                caption={`${METRICS.find((m) => m.value === metric)!.unit} per day over the last ${range} days`}
                unit={METRICS.find((m) => m.value === metric)!.unit}
                points={data.days.map((d) => ({ label: short(d.date), full: long(d.date), value: d[metric] }))}
              />
            </Panel>
          </Stagger>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Stagger i={3}>
              <Panel title="By platform" sub={`Planned posts, last ${range} days`}>
                {Object.keys(data.platforms).length ? (
                  <BarList
                    caption="Planned posts by platform"
                    rows={PLATFORM_ORDER.filter((id) => data.platforms[id])
                      .map((id) => ({
                        key: id,
                        name: PLATFORMS[id].name,
                        value: data.platforms[id] ?? 0,
                        label: (
                          <>
                            <PlatformIcon id={id} className="size-3.5 shrink-0 text-fg" />
                            <span className="truncate">{PLATFORMS[id].name}</span>
                          </>
                        ),
                      }))
                      .sort((a, b) => b.value - a.value)}
                  />
                ) : (
                  <p className="py-8 text-center text-[12.5px] text-dim">Nothing planned in this range.</p>
                )}
              </Panel>
            </Stagger>
            <Stagger i={4}>
              <Panel title="By format" sub={`Planned posts, last ${range} days`}>
                {Object.keys(data.formats).length ? (
                  <BarList
                    caption="Planned posts by format"
                    rows={(
                      [
                        { key: 'text', name: 'Text', icon: Type },
                        { key: 'image', name: 'Image', icon: Image },
                        { key: 'video', name: 'Video', icon: Clapperboard },
                      ] as const
                    )
                      .filter((f) => data.formats[f.key])
                      .map(({ key, name, icon: Icon }) => ({
                        key,
                        name,
                        value: data.formats[key] ?? 0,
                        label: (
                          <>
                            <Icon className="size-3.5 shrink-0 text-fg" strokeWidth={1.75} />
                            {name}
                          </>
                        ),
                      }))}
                  />
                ) : (
                  <p className="py-8 text-center text-[12.5px] text-dim">Nothing planned in this range.</p>
                )}
              </Panel>
            </Stagger>
          </div>

          <Stagger i={5}>
            <Panel
              title="When you post"
              sub="Every planned and published post, by weekday and hour"
              actions={
                <Segmented
                  id="heat-mode"
                  label="View"
                  value={heatMode}
                  onChange={setHeatMode}
                  options={[
                    { value: 'chart', label: 'Chart' },
                    { value: 'table', label: 'Table' },
                  ]}
                />
              }
            >
              <Heatmap grid={data.heatmap} mode={heatMode} />
            </Panel>
          </Stagger>
        </div>
      )}
    </div>
  )
}
