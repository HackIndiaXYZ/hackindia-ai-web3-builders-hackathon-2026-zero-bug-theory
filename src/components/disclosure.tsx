/* --------------------------------------------------------------------------
 * Disclosure — a collapsible block of explanatory copy.
 * --------------------------------------------------------------------------
 * Used across the result and insights screens to keep the honest-but-long
 * caveats reachable without turning every screen into a wall of text.
 *
 * Two details make it behave properly rather than just look right:
 *   - the panel is `inert` while collapsed, so links and buttons inside it are
 *     not silently reachable by keyboard from a closed section (the classic bug
 *     of the grid-rows collapse trick), and
 *   - the trigger and the panel are wired together with aria-controls /
 *     aria-labelledby so the panel is announced as a named region.
 * -------------------------------------------------------------------------- */

import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DisclosureProps {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
  /**
   * Heading level that wraps the trigger. Defaults to 3, which is right
   * directly under a screen's own h2 — hardcoding h4 produced an h2 -> h4 skip
   * on the result screen.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6
}

export function Disclosure({
  label,
  children,
  defaultOpen = false,
  headingLevel = 3,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)
  const uid = useId()
  const panelId = `disclosure-panel-${uid}`
  const triggerId = `disclosure-trigger-${uid}`
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

  return (
    <div
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'w-full overflow-hidden rounded-2xl border transition-colors duration-300',
        open ? 'border-primary/25 bg-card/80' : 'border-border bg-card/50 hover:border-border',
      )}
    >
      <Heading className="m-0">
        <button
          id={triggerId}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="ring-focus flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-medium text-foreground"
        >
          <span className="text-balance">{label}</span>
          <span
            aria-hidden="true"
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-300',
              open
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border/70 text-muted-foreground',
            )}
          >
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform duration-300 motion-reduce:transition-none',
                open && 'rotate-180',
              )}
            />
          </span>
        </button>
      </Heading>

      <div
        className={cn(
          'grid transition-all duration-300 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          inert={!open}
          className="min-h-0 overflow-hidden"
        >
          <div className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  )
}
