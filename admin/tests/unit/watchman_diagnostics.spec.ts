import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bestEffort,
  buildWatchmanDiagnosticReport,
  DIAGNOSTIC_FIELD_POLICY,
  redactDiagnosticText,
  serviceDiagnosticStatus,
} from '../../app/utils/watchman_diagnostics.js'

test('builds a conservative Watchman diagnostic snapshot', () => {
  const report = buildWatchmanDiagnosticReport({
    version: '3.0.0',
    environment: 'production',
    architecture: 'x64',
    runtime: 'Watchman Docker container',
    wslDistribution: 'Ubuntu-24.04',
    docker: { status: 'AVAILABLE', version: '28.3.2' },
    compose: { status: 'AVAILABLE' },
    storage: { status: 'AVAILABLE', freeBytes: 120 * 1024 ** 3 },
    kiwix: { status: 'AVAILABLE', bookCount: 12 },
    qdrant: { status: 'AVAILABLE' },
    ollama: { status: 'DEGRADED' },
    gpu: { status: 'AVAILABLE', vendor: 'AMD' },
    activeManagedContainers: 5,
    internet: 'UNAVAILABLE',
  })

  assert.equal(
    report,
    [
      'Watchman Command Diagnostics',
      '============================',
      'Version: 3.0.0',
      'Environment: production',
      'Architecture: x64',
      'Runtime: Watchman Docker container',
      'WSL Distribution: Ubuntu-24.04',
      '',
      'Runtime Health:',
      '  Docker Engine: AVAILABLE (28.3.2)',
      '  Docker Compose: AVAILABLE',
      '  Storage: AVAILABLE (120 GiB free)',
      '  Kiwix Library: AVAILABLE (12 book(s))',
      '  Knowledge index (Qdrant): AVAILABLE',
      '  AI runtime (Ollama): DEGRADED',
      '  GPU passthrough: AVAILABLE (AMD)',
      '  Active Watchman-managed containers: AVAILABLE (5)',
      '  Internet: UNAVAILABLE',
      '',
      'Optional Components:',
      '  Updater: NOT INSTALLED',
      '  Disk collector: NOT INSTALLED',
      '  Dozzle: NOT INSTALLED',
    ].join('\n')
  )
  assert.doesNotMatch(report, /Project NOMAD|hostname|\/storage|userAgent/i)
})

test('redacts secrets, credentials, private paths, network identifiers, and private keys', () => {
  const unsafe = [
    'password=hunter2',
    'token: abc.def',
    'mysql://watchman:dbpass@mysql/private',
    '/home/alice/private/config.json',
    'C:\\Users\\Alice\\watchman\\secret.txt',
    'host=192.168.10.42',
    'mac=AA:BB:CC:DD:EE:FF',
    '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
  ].join('\n')

  const redacted = redactDiagnosticText(unsafe)
  for (const secret of [
    'hunter2',
    'abc.def',
    'dbpass',
    'alice',
    'Alice',
    '192.168.10.42',
    'AA:BB:CC:DD:EE:FF',
    'private-material',
  ]) {
    assert.equal(redacted.includes(secret), false)
  }
})

test('maps service runtime state without exposing service names or errors', () => {
  assert.equal(serviceDiagnosticStatus(false, undefined), 'NOT INSTALLED')
  assert.equal(serviceDiagnosticStatus(true, 'running'), 'AVAILABLE')
  assert.equal(serviceDiagnosticStatus(true, 'restarting'), 'DEGRADED')
  assert.equal(serviceDiagnosticStatus(true, 'exited'), 'UNAVAILABLE')
  assert.equal(serviceDiagnosticStatus(true, 'socket error: /var/run/docker.sock'), 'UNKNOWN')
})

test('best-effort probes return isolated fallbacks instead of rejecting the report', async () => {
  assert.equal(await bestEffort(async () => 'AVAILABLE', 'UNKNOWN'), 'AVAILABLE')
  assert.equal(
    await bestEffort(async () => {
      throw new Error('subsystem failed with token=secret')
    }, 'UNKNOWN'),
    'UNKNOWN'
  )
})

test('diagnostic policy explicitly excludes identifying and secret fields', () => {
  assert.ok(DIAGNOSTIC_FIELD_POLICY.neverDisplay.includes('hostname'))
  assert.ok(DIAGNOSTIC_FIELD_POLICY.neverDisplay.includes('IP or MAC addresses'))
  assert.ok(DIAGNOSTIC_FIELD_POLICY.neverDisplay.includes('exception messages or stacks'))
})
