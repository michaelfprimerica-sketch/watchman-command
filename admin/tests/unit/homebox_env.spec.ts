import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  findValidHomeboxPepper,
  HOMEBOX_PEPPER_ENV,
  withHomeboxPepper,
} from '../../app/utils/homebox_env.js'

describe('Homebox runtime pepper environment', () => {
  it('adopts an existing valid pepper during upgrade', () => {
    const pepper = 'a'.repeat(32)
    assert.equal(findValidHomeboxPepper([`${HOMEBOX_PEPPER_ENV}=${pepper}`]), pepper)
  })

  it('rejects a short pepper that would crash Homebox', () => {
    assert.equal(findValidHomeboxPepper([`${HOMEBOX_PEPPER_ENV}=too-short`]), null)
  })

  it('injects exactly one stable pepper while preserving other settings', () => {
    const result = withHomeboxPepper(
      ['HBOX_OPTIONS_ALLOW_REGISTRATION=false', `${HOMEBOX_PEPPER_ENV}=old`],
      'b'.repeat(64)
    )
    assert.deepEqual(result, [
      'HBOX_OPTIONS_ALLOW_REGISTRATION=false',
      `${HOMEBOX_PEPPER_ENV}=${'b'.repeat(64)}`,
    ])
  })
})
