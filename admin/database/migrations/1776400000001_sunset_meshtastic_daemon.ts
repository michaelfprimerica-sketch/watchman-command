import { BaseSchema } from '@adonisjs/lucid/schema'
import { SERVICE_NAMES } from '../../constants/service_names.js'

export default class extends BaseSchema {
  protected tableName = 'services'

  async up() {
    this.defer(async (db) => {
      // Remove only a never-installed orphaned catalog row. Installed services
      // remain manageable and are merely hidden from new installs as legacy.
      await db
        .from(this.tableName)
        .where('service_name', SERVICE_NAMES.MESHTASTICD)
        .where('installed', false)
        .delete()

      await db
        .from(this.tableName)
        .where('service_name', SERVICE_NAMES.MESHTASTICD)
        .where('installed', true)
        .update({ is_deprecated: true })
    })
  }

  async down() {
    // The deprecated flag's column belongs to the legacy-service migration.
    // A deleted never-installed catalog row has no user data to restore.
  }
}
