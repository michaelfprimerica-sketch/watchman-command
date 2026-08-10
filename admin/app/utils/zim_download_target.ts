import { basename, resolve, sep } from 'node:path'

export interface ZimDownloadTarget {
  filename: string
  filepath: string
}

/** Resolve a remote ZIM URL to a filename confined beneath the supplied storage root. */
export function resolveZimDownloadTarget(url: string, storageRoot: string): ZimDownloadTarget {
  const parsed = new URL(url)
  if (!parsed.pathname.toLowerCase().endsWith('.zim')) {
    throw new Error(`Invalid ZIM file URL: ${url}. URL path must end with .zim`)
  }

  let filename: string
  try {
    filename = decodeURIComponent(basename(parsed.pathname))
  } catch {
    throw new Error('Invalid encoded ZIM filename')
  }

  // Decoding may reveal an encoded slash. Refuse it, dot segments, and any
  // value that is no longer a single filename.
  if (
    !filename ||
    filename === '.' ||
    filename === '..' ||
    filename !== basename(filename) ||
    !filename.toLowerCase().endsWith('.zim')
  ) {
    throw new Error('Invalid ZIM filename')
  }

  const basePath = resolve(storageRoot)
  const filepath = resolve(basePath, filename)
  if (!filepath.startsWith(basePath + sep)) {
    throw new Error('Invalid ZIM download path')
  }

  return { filename, filepath }
}
