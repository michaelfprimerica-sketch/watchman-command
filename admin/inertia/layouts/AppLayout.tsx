import { useState } from 'react'
import Footer from '~/components/Footer'
import ChatButton from '~/components/chat/ChatButton'
import ChatModal from '~/components/chat/ChatModal'
import useServiceInstalledStatus from '~/hooks/useServiceInstalledStatus'
import { SERVICE_NAMES } from '../../constants/service_names'
import { Link } from '@inertiajs/react'
import { IconArrowLeft } from '@tabler/icons-react'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const aiAssistantInstalled = useServiceInstalledStatus(SERVICE_NAMES.OLLAMA)

  return (
    <div className="min-h-screen flex flex-col">
      {
        window.location.pathname !== '/home' && (
          <Link href="/home" className="ml-4 mt-4 inline-flex items-center self-start">
            <IconArrowLeft className="mr-2" size={24} />
            <p className="text-lg text-text-secondary">Back to Home</p>
          </Link>
        )}
      <Link
        href="/home"
        className="flex flex-col items-center justify-center gap-2 p-4 text-center"
      >
        <img
          src="/watchman_command_mark.png"
          alt="Eagle and shield emblem"
          className="h-28 w-auto max-w-full object-contain sm:h-32 md:h-40"
        />
        <h1 className="text-3xl font-bold text-desert-green sm:text-4xl md:text-5xl">
          Watchman Command
        </h1>
        <p className="text-base font-semibold text-text-secondary sm:text-lg">
          Live Prepared. Stay Protected.
        </p>
      </Link>
      <hr className="h-[1.5px] border-none bg-desert-green font-semibold text-desert-green" />
      <div className="flex-1 w-full bg-desert">{children}</div>
      <Footer />

      {aiAssistantInstalled && (
        <>
          <ChatButton onClick={() => setIsChatOpen(true)} />
          <ChatModal open={isChatOpen} onClose={() => setIsChatOpen(false)} />
        </>
      )}
    </div>
  )
}
