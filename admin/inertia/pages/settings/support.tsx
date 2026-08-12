import { Head } from '@inertiajs/react'
import { IconExternalLink } from '@tabler/icons-react'
import SettingsLayout from '~/layouts/SettingsLayout'

export default function SupportPage() {
  return (
    <SettingsLayout>
      <Head title="Support Watchman Command" />
      <div className="xl:pl-72 w-full">
        <main className="px-12 py-6 max-w-4xl">
          <h1 className="text-4xl font-semibold mb-4">Support Watchman Command</h1>
          <p className="text-text-muted mb-10 text-lg">
            The Watchman Command core is free and open source — no subscription or paywall is needed
            to run it. Optional proprietary Watchman Knowledge Packs are separately governed content
            and may have their own acquisition or membership terms. If you'd like to help keep the
            core project going, here are a few ways to show your support.
          </p>

          {/* Ko-fi */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-3">Buy Us a Coffee</h2>
            <p className="text-text-muted mb-4">
              Every contribution helps fund development and server costs for the open-source
              Watchman Command core. Even a small donation goes a long way.
            </p>
            <a
              href="https://ko-fi.com/crosstalk"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-desert-orange hover:bg-desert-orange-dark text-white font-semibold rounded-lg transition-colors"
            >
              Support on Ko-fi
              <IconExternalLink size={18} />
            </a>
          </section>

          {/* Rogue Support */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-3">Need Help With Your Home Network?</h2>
            <a
              href="https://rogue.support"
              target="_blank"
              rel="noopener noreferrer"
              className="block mb-4 rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
            >
              <img
                src="/rogue-support-banner.webp"
                alt="Rogue Support — Conquer Your Home Network"
                className="w-full"
              />
            </a>
            <p className="text-text-muted mb-4">
              Rogue Support is a networking consultation service for home users. Think of it as Uber
              for computer networking — expert help when you need it.
            </p>
            <a
              href="https://rogue.support"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-desert-green hover:text-desert-green-dark hover:underline font-medium"
            >
              Visit Rogue.Support
              <IconExternalLink size={16} />
            </a>
          </section>

          {/* Other Ways to Help */}
          <section className="mb-10">
            <h2 className="text-2xl font-semibold mb-3">Other Ways to Help</h2>
            <ul className="space-y-2 text-text-muted">
              <li>
                <a
                  href="https://github.com/Crosstalk-Solutions/project-nomad"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-desert-green hover:text-desert-green-dark hover:underline"
                >
                  Star the project on GitHub
                </a>{' '}
                — it helps more people discover Watchman Command
              </li>
              <li>
                <a
                  href="https://github.com/Crosstalk-Solutions/project-nomad/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-desert-green hover:text-desert-green-dark hover:underline"
                >
                  Report bugs and suggest features
                </a>{' '}
                — every report makes Watchman Command better
              </li>
              <li>
                Share Watchman Command with someone who'd use it — word of mouth is the best
                marketing
              </li>
              <li>
                <a
                  href="https://discord.com/invite/crosstalksolutions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-desert-green hover:text-desert-green-dark hover:underline"
                >
                  Join the Discord community
                </a>{' '}
                — hang out, share your build, help other users
              </li>
            </ul>
          </section>
        </main>
      </div>
    </SettingsLayout>
  )
}
