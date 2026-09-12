import { cn } from '@/lib/utils'

type SeparatorProps = Omit<React.ComponentProps<'div'>, 'children' | 'role'> & {
  orientation?: 'horizontal' | 'vertical'
}

/** Separator — a hairline rule that announces itself correctly to assistive tech. */
function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: SeparatorProps) {
  return (
    <div
      data-slot="separator"
      data-orientation={orientation}
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal'
          ? 'h-px w-full'
          : 'h-full min-h-4 w-px self-stretch',
        className,
      )}
      {...props}
    />
  )
}

export { Separator }
