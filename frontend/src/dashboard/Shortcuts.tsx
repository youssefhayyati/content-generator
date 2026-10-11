import { Fragment } from 'react'
import { Kbd, Modal } from './ui'

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

/** Every shortcut the studio answers to, by where it works. Opened with ? from anywhere. */
const GROUPS: Array<{ where: string; keys: Array<[keys: string[], what: string]> }> = [
  {
    where: 'Anywhere',
    keys: [
      [[MOD, 'K'], 'Search posts, jump to a page, or name a palette'],
      [['N'], 'Start a new post'],
      [['['], 'Fold the sidebar to its icons, or open it again'],
      [['?'], 'These shortcuts'],
      [['Esc'], 'Close whatever is open'],
    ],
  },
  {
    where: 'Writing',
    keys: [
      [['Enter'], 'Write it (in a prompt box)'],
      [['Shift', 'Enter'], 'A new line instead'],
      [[MOD, 'Enter'], 'Save the post (composer), build the flow (Say it)'],
    ],
  },
  {
    where: 'Canvases',
    keys: [
      [['Drag'], 'Move around the Flows board or a Creative Lab canvas'],
      [[MOD, 'Scroll'], 'Zoom in and out'],
    ],
  },
]

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" className="max-w-lg">
      <div className="space-y-6">
        {GROUPS.map((g) => (
          <section key={g.where}>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{g.where}</p>
            <dl className="mt-2 divide-y divide-line">
              {g.keys.map(([keys, what]) => (
                <div key={what} className="flex items-center justify-between gap-6 py-2.5">
                  <dt className="text-[13px] text-muted">{what}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {keys.map((k, i) => (
                      <Fragment key={k}>
                        {i > 0 && <span className="text-[11px] text-dim">+</span>}
                        <Kbd>{k}</Kbd>
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}
