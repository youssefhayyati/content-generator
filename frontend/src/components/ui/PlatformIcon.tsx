import { useId } from 'react'
import { siFacebook, siInstagram, siPinterest, siTiktok, siX, siYoutube } from 'simple-icons'
import { cn } from '../../lib/cn'

export type PlatformId = 'instagram' | 'tiktok' | 'x' | 'linkedin' | 'facebook' | 'youtube' | 'pinterest'

export const PLATFORMS: Record<PlatformId, { name: string }> = {
  instagram: { name: 'Instagram' },
  tiktok: { name: 'TikTok' },
  x: { name: 'X' },
  linkedin: { name: 'LinkedIn' },
  facebook: { name: 'Facebook' },
  youtube: { name: 'YouTube' },
  pinterest: { name: 'Pinterest' },
}

const PATHS: Partial<Record<PlatformId, string>> = {
  instagram: siInstagram.path,
  tiktok: siTiktok.path,
  x: siX.path,
  facebook: siFacebook.path,
  youtube: siYoutube.path,
  pinterest: siPinterest.path,
}

/** Monochrome platform marks. They inherit `currentColor` so they sit quietly in the UI. */
// cn() doesn't merge classes, and size-4 sits after every smaller size in the stylesheet:
// the default size applies only when the caller hasn't asked for one.
const iconClass = (className?: string) => cn(!/(^|\s)size-/.test(className ?? '') && 'size-4', 'shrink-0', className)

export function PlatformIcon({ id, className }: { id: PlatformId; className?: string }) {
  const maskId = useId()

  if (id === 'linkedin') {
    // Not shipped by simple-icons, so drawn by hand: a rounded tile with "in" knocked out.
    return (
      <svg viewBox="0 0 24 24" className={iconClass(className)} aria-label="LinkedIn" role="img">
        <mask id={maskId}>
          <rect width="24" height="24" fill="#fff" />
          <circle cx="7.1" cy="7.2" r="1.65" fill="#000" />
          <rect x="5.65" y="9.6" width="2.9" height="9" fill="#000" />
          <path
            d="M10.6 9.6h2.8v1.25c.45-.8 1.5-1.5 3-1.5 3 0 3.55 1.95 3.55 4.5v4.75h-2.9v-4.2c0-1.05-.05-2.35-1.45-2.35-1.45 0-1.7 1.1-1.7 2.3v4.25h-2.9z"
            fill="#000"
          />
        </mask>
        <rect x="1.5" y="1.5" width="21" height="21" rx="3.5" fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" className={iconClass(className)} aria-label={PLATFORMS[id].name} role="img" fill="currentColor">
      <path d={PATHS[id]} />
    </svg>
  )
}
