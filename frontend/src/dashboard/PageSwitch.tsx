import { useRouter } from '../lib/router'
import type { View } from './nav'
import { Segmented } from './ui'

/**
 * The switch between a place's two views (Creative Lab's canvas and quick tools, Inspire's trends
 * and the showcase). Each view is a page of its own; this sits in both headers, in the same spot,
 * so going from one to the other reads as a tab rather than as leaving.
 */
export function PageSwitch({ id, label, views }: { id: string; label: string; views: View[] }) {
  const { path, navigate } = useRouter()
  return (
    <Segmented
      id={id}
      label={label}
      options={views.map((v) => ({ value: v.path, label: v.label }))}
      value={views.some((v) => v.path === path) ? path : views[0].path}
      onChange={(to) => navigate(to)}
      className="w-fit"
    />
  )
}
