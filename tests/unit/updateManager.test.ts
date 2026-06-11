import assert from 'node:assert/strict'
import { test } from 'node:test'

import { UpdateManager } from '../../src/main/services/updateManager'

class FakeTelemetry {
  public captureCalls: unknown[] = []
  public captureErrorCalls: unknown[] = []

  capture(payload: unknown) {
    this.captureCalls.push(payload)
  }

  captureError(...args: unknown[]) {
    this.captureErrorCalls.push(args)
  }
}

test('UpdateManager keeps release-update status disabled when auto-update is not enabled', async () => {
  const telemetry = new FakeTelemetry()
  const manager = new UpdateManager(telemetry as never, '1.0.0')

  await manager.start({
    enabled: false,
    channel: 'latest',
    autoDownload: false
  })

  const status = manager.getStatus()

  assert.equal(status.enabled, false)
  assert.equal(status.state, 'disabled')
  assert.equal(status.channel, 'latest')
})

test('UpdateManager reports update availability and installs downloaded updates', async () => {
  const telemetry = new FakeTelemetry()
  const manager = new UpdateManager(telemetry as never, '1.0.0')
  const listeners = new Map<string, (...args: unknown[]) => void>()
  let quitAndInstallCalls = 0

  const fakeUpdater = {
    autoDownload: false,
    allowDowngrade: false,
    channel: 'latest',
    on(eventName: string, listener: (...args: unknown[]) => void) {
      listeners.set(eventName, listener)
    },
    checkForUpdates() {
      listeners.get('checking-for-update')?.()
      listeners.get('update-available')?.({ version: '1.0.1' })
      return Promise.resolve(undefined)
    },
    quitAndInstall() {
      quitAndInstallCalls += 1
    }
  }

  ;(manager as never as { attachEventHandlers: (updater: unknown) => void }).attachEventHandlers(fakeUpdater)
  ;(manager as never as { updater: unknown }).updater = fakeUpdater
  ;(manager as never as { status: unknown }).status = {
    enabled: true,
    currentVersion: '1.0.0',
    channel: 'latest',
    autoDownload: false,
    state: 'enabled',
    latestVersion: null,
    downloadedVersion: null,
    lastCheckedAt: null,
    lastError: null
  }

  const status = await manager.checkForUpdates()

  assert.equal(status.state, 'update-available')
  assert.equal(status.latestVersion, '1.0.1')

  ;(manager as never as { status: unknown }).status = {
    ...status,
    state: 'downloaded',
    downloadedVersion: '1.0.1'
  }

  assert.equal(manager.installDownloadedUpdate(), true)
  assert.equal(quitAndInstallCalls, 1)
})
