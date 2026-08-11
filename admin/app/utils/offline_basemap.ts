import { constants } from 'node:fs'
import { access, open, stat } from 'node:fs/promises'

import type { OfflineBasemapStatus } from '../../types/maps.js'

const PMTILES_V3_HEADER_PREFIX = Buffer.from([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 0x03])
const PMTILES_V3_HEADER_LENGTH = 127

/** Inspect a PMTiles v3 basemap without changing it or disclosing its path. */
export async function inspectOfflineBasemap(
  mapStorageDirectory: string,
  worldBasemapPath: string
): Promise<Exclude<OfflineBasemapStatus, 'service_unavailable'>> {
  try {
    await access(mapStorageDirectory, constants.R_OK)
  } catch {
    return 'storage_unavailable'
  }

  let worldStats
  try {
    worldStats = await stat(worldBasemapPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    return 'unreadable'
  }

  if (!worldStats.isFile() || worldStats.size < PMTILES_V3_HEADER_LENGTH) return 'corrupt'

  let handle
  try {
    handle = await open(worldBasemapPath, 'r')
    const header = Buffer.alloc(PMTILES_V3_HEADER_PREFIX.length)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead !== header.length || !header.equals(PMTILES_V3_HEADER_PREFIX)) return 'corrupt'
    return 'available'
  } catch {
    return 'unreadable'
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
