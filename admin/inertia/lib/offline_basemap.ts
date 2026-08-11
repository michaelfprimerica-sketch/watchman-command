import type { OfflineBasemapDiagnostic } from '../../types/maps.js'

export type OfflineBasemapNotice = {
  title: string
  message: string
  canDownload: boolean
}

export function getOfflineBasemapNotice(
  diagnostic: OfflineBasemapDiagnostic
): OfflineBasemapNotice | null {
  if (diagnostic.status === 'available') return null

  const regionalSuffix = diagnostic.regionalMapsPresent
    ? ' Downloaded regional map files may still be available.'
    : ''

  switch (diagnostic.status) {
    case 'missing':
      return {
        title: 'Offline basemap unavailable',
        message:
          'The low-zoom world basemap has not been downloaded. Connect Watchman Command to the internet once to prepare it for offline use.' +
          regionalSuffix,
        canDownload: true,
      }
    case 'corrupt':
      return {
        title: 'Offline basemap needs attention',
        message:
          'The world basemap file is not valid. Watchman Command left it unchanged.' +
          regionalSuffix,
        canDownload: false,
      }
    case 'unreadable':
      return {
        title: 'Offline basemap unreadable',
        message:
          'Watchman Command cannot read the world basemap. Check storage permissions.' +
          regionalSuffix,
        canDownload: false,
      }
    case 'storage_unavailable':
      return {
        title: 'Map storage unavailable',
        message: 'Watchman Command cannot access map storage.' + regionalSuffix,
        canDownload: false,
      }
    case 'service_unavailable':
      return {
        title: 'Map service unavailable',
        message: 'Watchman Command could not check offline map health.' + regionalSuffix,
        canDownload: false,
      }
  }
}
