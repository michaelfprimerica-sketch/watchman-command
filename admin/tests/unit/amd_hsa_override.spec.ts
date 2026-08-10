import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { mapGfxToHsaOverride, withAmdOllamaEnvironment } from '../../app/utils/amd_hsa_override.js'

describe('AMD HSA override mapping', () => {
  it('coerces Phoenix, Hawk Point, Radeon 780M, and Radeon 760M gfx1103', () => {
    assert.equal(mapGfxToHsaOverride('gfx1103'), '11.0.0')
  })

  it('keeps supported discrete and Strix AMD targets on native discovery', () => {
    for (const gfx of ['gfx1030', 'gfx1100', 'gfx1101', 'gfx1102', 'gfx1150', 'gfx1151']) {
      assert.equal(mapGfxToHsaOverride(gfx), null)
    }
  })

  it('coerces unsupported RDNA2 iGPUs and leaves unknown targets native', () => {
    for (const gfx of ['gfx1031', 'gfx1034', 'gfx1035', 'gfx1036']) {
      assert.equal(mapGfxToHsaOverride(gfx), '10.3.0')
    }
    assert.equal(mapGfxToHsaOverride('gfx9999'), null)
    assert.equal(mapGfxToHsaOverride(''), null)
  })

  it('adds safe iGPU configuration without changing unrelated NVIDIA/CPU env', () => {
    assert.deepEqual(
      withAmdOllamaEnvironment(
        ['OLLAMA_NO_CLOUD=1', 'NVIDIA_VISIBLE_DEVICES=all', 'OLLAMA_IGPU_ENABLE=0'],
        '11.0.0'
      ),
      [
        'OLLAMA_NO_CLOUD=1',
        'NVIDIA_VISIBLE_DEVICES=all',
        'HSA_OVERRIDE_GFX_VERSION=11.0.0',
        'OLLAMA_IGPU_ENABLE=1',
      ]
    )
    assert.deepEqual(withAmdOllamaEnvironment(['CPU_ONLY=1'], null), [
      'CPU_ONLY=1',
      'OLLAMA_IGPU_ENABLE=1',
    ])
    assert.deepEqual(withAmdOllamaEnvironment([], '$(touch /tmp/injected)'), [
      'OLLAMA_IGPU_ENABLE=1',
    ])
  })

  it('statically verifies the adapted installer detection without replacing Watchman paths', async () => {
    const installer = await readFile(
      new URL('../../../install/install_nomad.sh', import.meta.url),
      'utf8'
    )
    assert.match(installer, /Phoenix\[0-9\]\?\|Hawk Point\|Radeon \(780M\|760M\)/)
    assert.doesNotMatch(installer, /\/home\/user\/Development\/watchman-command/)
    assert.match(installer, /NOMAD_DIR="\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\."/)
    const dockerService = await readFile(
      new URL('../../app/services/docker_service.ts', import.meta.url),
      'utf8'
    )
    assert.match(dockerService, /if \(amdGpuConfigured\)[\s\S]*withAmdOllamaEnvironment/)
    assert.match(dockerService, /if \(updatedAmdGpuConfigured\)[\s\S]*withAmdOllamaEnvironment/)
  })
})
