import type { User } from 'firebase/auth'
import { AppLogo } from '@/src/components/app-logo'
import { HowItWorksSheet } from '@/src/components/how-it-works-sheet'
import { LogOut, Stethoscope } from 'lucide-react'

interface SiteHeaderProps {
  onHome: () => void
  onDoctorPortal: () => void
  onSignOut: () => void
  user: User | null
}

export function SiteHeader({ onHome, onDoctorPortal, onSignOut, user }: SiteHeaderProps) {
  return (
    <header className="w-full border-b border-border/60">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4 lg:px-10">
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-2.5 text-foreground"
        >
          <AppLogo className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">AnemiaScan</span>
        </button>

        <nav className="flex items-center gap-6">
          <HowItWorksSheet>
            <button
              type="button"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              How it works
            </button>
          </HowItWorksSheet>
          <button
            type="button"
            onClick={onDoctorPortal}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <Stethoscope className="h-4 w-4 sm:hidden" />
            <span className="hidden sm:inline">Doctor portal</span>
          </button>
          {user && (
            <button
              type="button"
              onClick={onSignOut}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </nav>
      </div>
    </header>
  )
}
