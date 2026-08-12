import { MapService } from '#services/map_service'
import MapMarker from '#models/map_marker'
import {
  assertNotPrivateUrl,
  downloadCollectionValidator,
  filenameParamValidator,
  mapExtractPreflightValidator,
  mapExtractValidator,
  remoteDownloadValidator,
  remoteDownloadValidatorOptional,
} from '#validators/common'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { createMapMarkerValidator, updateMapMarkerValidator } from '#validators/map_markers'

@inject()
export default class MapsController {
  constructor(private mapService: MapService) {}

  async index({ inertia }: HttpContext) {
    const baseAssetsCheck = await this.mapService.ensureBaseAssets().catch(() => false)
    const regionFiles = await this.mapService.listRegions().catch(() => ({ files: [] }))
    const offlineBasemap = await this.mapService
      .getOfflineBasemapDiagnostic(regionFiles.files.length > 0)
      .catch(() => ({
        status: 'service_unavailable' as const,
        regionalMapsPresent: regionFiles.files.length > 0,
      }))
    return inertia.render('maps', {
      maps: {
        baseAssetsExist: baseAssetsCheck,
        offlineBasemap,
        regionFiles: regionFiles.files,
      },
    })
  }

  async downloadBaseAssets({ request, response }: HttpContext) {
    const payload = await request.validateUsing(remoteDownloadValidatorOptional)
    if (payload.url) assertNotPrivateUrl(payload.url)
    let ready = false
    try {
      if (payload.url) {
        ready = await this.mapService.downloadBaseAssets(payload.url)
      } else {
        const baseAssetsReady = await this.mapService.ensureBaseAssets()
        const basemap = await this.mapService.getOfflineBasemapDiagnostic(false)
        ready = baseAssetsReady && basemap.status === 'available'
      }
    } catch {
      // Return only a stable, path-free error below.
    }
    if (!ready) {
      return response.status(503).send({
        message: 'The offline map assets could not be prepared. Check storage and connectivity.',
      })
    }
    return { success: true }
  }

  async downloadRemote({ request }: HttpContext) {
    const payload = await request.validateUsing(remoteDownloadValidator)
    assertNotPrivateUrl(payload.url)
    const filename = await this.mapService.downloadRemote(payload.url)
    return {
      message: 'Download started successfully',
      filename,
      url: payload.url,
    }
  }

  async downloadCollection({ request }: HttpContext) {
    const payload = await request.validateUsing(downloadCollectionValidator)
    const resources = await this.mapService.downloadCollection(payload.slug)
    return {
      message: 'Collection download started successfully',
      slug: payload.slug,
      resources,
    }
  }

  // For providing a "preflight" check in the UI before actually starting a background download
  async downloadRemotePreflight({ request }: HttpContext) {
    const payload = await request.validateUsing(remoteDownloadValidator)
    assertNotPrivateUrl(payload.url)
    const info = await this.mapService.downloadRemotePreflight(payload.url)
    return info
  }

  async fetchLatestCollections({}: HttpContext) {
    const success = await this.mapService.fetchLatestCollections()
    return { success }
  }

  async listCuratedCollections({}: HttpContext) {
    return await this.mapService.listCuratedCollections()
  }

  async listRegions({}: HttpContext) {
    return await this.mapService.listRegions()
  }

  async globalMapInfo({}: HttpContext) {
    return await this.mapService.getGlobalMapInfo()
  }

  async downloadGlobalMap({}: HttpContext) {
    const result = await this.mapService.downloadGlobalMap()
    return {
      message: 'Download started successfully',
      ...result,
    }
  }

  async listCountries({}: HttpContext) {
    return { countries: await this.mapService.listCountries() }
  }

  async listCountryGroups({}: HttpContext) {
    return { groups: await this.mapService.listCountryGroups() }
  }

  async extractPreflight({ request }: HttpContext) {
    const payload = await request.validateUsing(mapExtractPreflightValidator)
    return await this.mapService.extractPreflight(payload)
  }

  async extractRegion({ request }: HttpContext) {
    const payload = await request.validateUsing(mapExtractValidator)
    const result = await this.mapService.extractRegion(payload)
    return {
      message: 'Extract started successfully',
      ...result,
    }
  }

  async styles({ request, response }: HttpContext) {
    // Automatically ensure base assets are present before generating styles
    const baseAssetsExist = await this.mapService.ensureBaseAssets()
    if (!baseAssetsExist) {
      return response.status(500).send({
        message:
          'Base map assets are missing and could not be downloaded. Please check your connection and try again.',
      })
    }

    const forwardedProto = request.headers()['x-forwarded-proto']

    const protocol: string = forwardedProto
      ? typeof forwardedProto === 'string'
        ? forwardedProto
        : request.protocol()
      : request.protocol()

    const styles = await this.mapService.generateStylesJSON(request.host(), protocol)
    return response.json(styles)
  }

  async delete({ request, response }: HttpContext) {
    const payload = await request.validateUsing(filenameParamValidator)

    try {
      await this.mapService.delete(payload.params.filename)
    } catch (error) {
      if (error.message === 'not_found') {
        return response.status(404).send({
          message: `Map file with key ${payload.params.filename} not found`,
        })
      }
      throw error // Re-throw any other errors and let the global error handler catch
    }

    return {
      message: 'Map file deleted successfully',
    }
  }

  // --- Map Markers ---

  async listMarkers({}: HttpContext) {
    return await MapMarker.query().orderBy('created_at', 'asc')
  }

  async createMarker({ request }: HttpContext) {
    const payload = await request.validateUsing(createMapMarkerValidator)
    const marker = await MapMarker.create({
      name: payload.name,
      longitude: payload.longitude,
      latitude: payload.latitude,
      color: payload.color ?? 'orange',
      notes: payload.notes ?? null,
      marker_type: payload.marker_type ?? 'pin',
    })
    return marker
  }

  async updateMarker({ request, response }: HttpContext) {
    const { id } = request.params()
    const marker = await MapMarker.find(id)
    if (!marker) {
      return response.status(404).send({ message: 'Marker not found' })
    }
    const payload = await request.validateUsing(updateMapMarkerValidator)
    if (payload.name !== undefined) marker.name = payload.name
    if (payload.color !== undefined) marker.color = payload.color
    if (payload.longitude !== undefined) marker.longitude = payload.longitude
    if (payload.latitude !== undefined) marker.latitude = payload.latitude
    if (payload.notes !== undefined) marker.notes = payload.notes
    if (payload.marker_type !== undefined) marker.marker_type = payload.marker_type
    await marker.save()
    return marker
  }

  async deleteMarker({ request, response }: HttpContext) {
    const { id } = request.params()
    const marker = await MapMarker.find(id)
    if (!marker) {
      return response.status(404).send({ message: 'Marker not found' })
    }
    await marker.delete()
    return { message: 'Marker deleted' }
  }
}
