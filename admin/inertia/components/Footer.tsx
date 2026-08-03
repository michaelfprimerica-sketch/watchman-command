import { useState } from 'react'
import { usePage } from '@inertiajs/react'
import { UsePageProps } from '../../types/system'
import ThemeToggle from '~/components/ThemeToggle'
import { IconBug } from '@tabler/icons-react'
import DebugInfoModal from './DebugInfoModal'

export default function Footer() {
  const { appVersion } = usePage().props as unknown as UsePageProps
  const [debugModalOpen, setDebugModalOpen] = useState(false)

  return (
    <footer>
      <div className="flex flex-col items-center justify-center gap-2 border-t border-border-subtle px-4 py-4 text-center sm:flex-row sm:flex-wrap sm:gap-3">
        <p className="text-sm/6 text-text-secondary">
          Watchman Command v{appVersion} · Live Prepared. Stay Protected.
        </p>
        <span aria-hidden="true" className="hidden text-gray-300 sm:inline">
          |
        </span>
        <button
          onClick={() => setDebugModalOpen(true)}
          className="text-sm/6 text-gray-500 hover:text-desert-green flex items-center gap-1 cursor-pointer"
        >
          <IconBug className="size-3.5" />
          Debug Info
        </button>
        <ThemeToggle />
      </div>
      <DebugInfoModal open={debugModalOpen} onClose={() => setDebugModalOpen(false)} />
    </footer>
  )
}
