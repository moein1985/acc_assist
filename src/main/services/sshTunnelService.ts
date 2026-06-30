import net, { type AddressInfo } from 'node:net'
import { EventEmitter } from 'node:events'
import { Client, type ConnectConfig } from 'ssh2'
import { createHash } from 'node:crypto'

import type { SshTunnelConfig, SshTunnelStatus, ConnectionLogEntry, ConnectionDiagnosticInfo } from '../../shared/contracts'

const LOCAL_HOST = '127.0.0.1'
const SHUTDOWN_TIMEOUT_MS = 1500
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_BASE_DELAY_MS = 1000
const MAX_LOG_ENTRIES = 100
const DEBUG_SSH = process.env.ACC_DEBUG_SSH === '1'

export type SshTunnelEvent = 'status-changed' | 'hostkey-mismatch'

export interface HostKeyStore {
  getHostKey(host: string, port: number): string | undefined
  saveHostKey(host: string, port: number, fingerprint: string): void
  removeHostKey(host: string, port: number): void
}

export interface HostKeyMismatchInfo {
  host: string
  port: number
  expected: string | undefined
  got: string
}

export class SshTunnelService extends EventEmitter {
  private client: Client | null = null
  private server: net.Server | null = null
  private readonly activeSockets = new Set<net.Socket>()
  private stopPromise: Promise<SshTunnelStatus> | null = null
  private lastConfig: SshTunnelConfig | null = null
  private manualStop = false
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private hostKeyStore: HostKeyStore | null = null
  private readonly logBuffer: ConnectionLogEntry[] = []
  private lastError: string | null = null
  private lastErrorAt: number | null = null
  private status: SshTunnelStatus = {
    active: false,
    reconnecting: false,
    reconnectAttempt: 0,
    localHost: LOCAL_HOST,
    localPort: null,
    message: 'Tunnel is not started'
  }

  getStatus(): SshTunnelStatus {
    return this.status
  }

  setHostKeyStore(store: HostKeyStore | null): void {
    this.hostKeyStore = store
  }

  getDiagnosticInfo(): Pick<ConnectionDiagnosticInfo, 'logs' | 'sshActive' | 'sshReconnecting' | 'sshLocalHost' | 'sshLocalPort' | 'sshDstHost' | 'sshDstPort' | 'sshMessage' | 'lastError' | 'lastErrorAt'> {
    return {
      logs: [...this.logBuffer],
      sshActive: this.status.active,
      sshReconnecting: this.status.reconnecting,
      sshLocalHost: this.status.localHost,
      sshLocalPort: this.status.localPort,
      sshDstHost: this.lastConfig?.dstHost ?? null,
      sshDstPort: this.lastConfig?.dstPort ?? null,
      sshMessage: this.status.message,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt
    }
  }

  private addLog(level: ConnectionLogEntry['level'], source: ConnectionLogEntry['source'], message: string): void {
    this.logBuffer.push({ timestamp: Date.now(), level, source, message })
    if (this.logBuffer.length > MAX_LOG_ENTRIES) {
      this.logBuffer.shift()
    }
  }

  async start(config: SshTunnelConfig): Promise<SshTunnelStatus> {
    if (!config.enabled) {
      await this.stop('SSH tunnel is disabled by settings')
      return this.status
    }

    this.manualStop = false
    this.reconnectAttempts = 0
    this.clearReconnectTimer()

    this.addLog('info', 'ssh', `شروع اتصال به ${config.host}:${config.port}`)

    this.validateConfig(config)

    // If tunnel is already active with the same config, skip restart
    if (this.status.active && this.lastConfig && this.isSameConfig(config, this.lastConfig)) {
      this.addLog('info', 'ssh', 'تونل از قبل فعال است — نیاز به راه‌اندازی مجدد نیست')
      return this.status
    }

    this.lastConfig = config

    await this.stop('Restarting tunnel with new configuration')

    const client = new Client()
    let server: net.Server | null = null

    try {
      this.emitProgress(1, 5, 'در حال اتصال به سرور SSH...')
      await this.connectClient(client, config)

      this.emitProgress(2, 5, 'در حال ساخت تونل...')
      server = this.createForwardServer(client, config)
      const localPort = await this.listenServer(server, config.localPort ?? 0)

      this.attachRuntimeListeners(client, server)

      this.client = client
      this.server = server
      this.reconnectAttempts = 0
      this.status = {
        active: true,
        reconnecting: false,
        reconnectAttempt: 0,
        localHost: LOCAL_HOST,
        localPort,
        message: `تونل فعال شد: ${LOCAL_HOST}:${localPort} -> ${config.dstHost}:${config.dstPort}`
      }
      this.emitStatusChanged()
      this.emitProgress(5, 5, 'اتصال برقرار شد ✅')
      this.addLog('info', 'ssh', `تونل فعال شد: ${LOCAL_HOST}:${localPort} -> ${config.dstHost}:${config.dstPort}`)

      return this.status
    } catch (error) {
      await this.disposeTransientResources(server, client)
      const message = error instanceof Error ? error.message : String(error)
      const persianMessage = this.translateSshError(message)
      this.emitProgress(0, 5, `خطا: ${persianMessage}`, true)
      this.lastError = persianMessage
      this.lastErrorAt = Date.now()
      this.addLog('error', 'ssh', `خطا در برقراری تونل: ${persianMessage}`)
      this.status = {
        active: false,
        reconnecting: false,
        reconnectAttempt: 0,
        localHost: LOCAL_HOST,
        localPort: null,
        message: `خطا در برقراری تونل SSH: ${persianMessage}`
      }
      this.emitStatusChanged()

      throw new Error(`امکان برقراری تونل SSH وجود ندارد: ${persianMessage}`)
    }
  }

  private translateSshError(message: string): string {
    const lower = message.toLowerCase()
    if (lower.includes('all configured authentication methods failed')) {
      return 'احراز هویت ناموفق بود. نام کاربری، رمز عبور یا کلید خصوصی را بررسی کنید.'
    }
    if (lower.includes('timed out while waiting for handshake')) {
      return 'زمان انتظار برای دست‌تکانی (Handshake) به پایان رسید. وضعیت شبکه یا پورت را بررسی کنید.'
    }
    if (lower.includes('econnrefused')) {
      return 'اتصال توسط سرور مقصد رد شد. پورت SSH یا فایروال سرور را بررسی کنید.'
    }
    if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
      return 'آدرس سرور SSH پیدا نشد. لطفاً Hostname را بررسی کنید.'
    }
    if (lower.includes('unsupported key type')) {
      return 'قالب کلید خصوصی (Private Key) پشتیبانی نمی‌شود.'
    }
    if (lower.includes('encrypted private key')) {
      return 'کلید خصوصی رمزگذاری شده است. لطفاً Passphrase را وارد کنید.'
    }
    if (lower.includes('host key verification failed')) {
      return 'کلید سرور تغییر کرده است. این می‌تواند نشانه حمله باشد.'
    }
    if (lower.includes('socket hung up')) {
      return 'اتصال شبکه قطع شد. ممکن است سرور در دسترس نباشد.'
    }
    if (lower.includes('keepalive timeout')) {
      return 'سرور پاسخ نداد. ممکن است قطع شده باشد.'
    }
    if (lower.includes('channel open failure')) {
      return 'باز کردن کانال تونل ناموفق بود. ممکن است پورت مقصد در دسترس نباشد.'
    }
    return message
  }

  async stop(message = 'Tunnel stopped'): Promise<SshTunnelStatus> {
    this.manualStop = true
    this.clearReconnectTimer()
    this.reconnectAttempts = 0
    this.addLog('info', 'ssh', `توقف تونل: ${message}`)

    if (this.stopPromise) {
      await this.stopPromise
      this.status = {
        active: false,
        reconnecting: false,
        reconnectAttempt: 0,
        localHost: LOCAL_HOST,
        localPort: null,
        message
      }
      this.emitStatusChanged()
      return this.status
    }

    this.stopPromise = this.stopInternal(message)

    try {
      return await this.stopPromise
    } finally {
      this.stopPromise = null
    }
  }

  private async stopInternal(message: string): Promise<SshTunnelStatus> {
    const server = this.server
    const client = this.client

    this.server = null
    this.client = null

    for (const socket of this.activeSockets) {
      socket.destroy()
    }
    this.activeSockets.clear()

    if (server) {
      await this.closeServer(server)
    }

    if (client) {
      await this.closeClient(client)
    }

    this.status = {
      active: false,
      reconnecting: false,
      reconnectAttempt: 0,
      localHost: LOCAL_HOST,
      localPort: null,
      message
    }
    this.emitStatusChanged()

    return this.status
  }

  private validateConfig(config: SshTunnelConfig): void {
    if (!config.host.trim()) {
      throw new Error('آدرس سرور SSH وارد نشده است.')
    }

    if (!config.username.trim()) {
      throw new Error('نام کاربری SSH وارد نشده است.')
    }

    if (!config.dstHost.trim()) {
      throw new Error('آدرس مقصد نهایی (Database Host) وارد نشده است.')
    }

    if (config.dstPort <= 0) {
      throw new Error('پورت مقصد نهایی باید عددی بزرگتر از صفر باشد.')
    }

    const hasPrivateKey = config.privateKey.trim().length > 0
    const hasPassword = config.password.trim().length > 0

    if (!hasPrivateKey && !hasPassword) {
      throw new Error('رمز عبور یا کلید خصوصی (Private Key) برای اتصال SSH الزامی است.')
    }
  }

  private isSameConfig(a: SshTunnelConfig, b: SshTunnelConfig): boolean {
    return (
      a.host === b.host &&
      a.port === b.port &&
      a.username === b.username &&
      a.password === b.password &&
      a.privateKey === b.privateKey &&
      a.passphrase === b.passphrase &&
      a.dstHost === b.dstHost &&
      a.dstPort === b.dstPort &&
      a.enabled === b.enabled
    )
  }

  private createForwardServer(client: Client, config: SshTunnelConfig): net.Server {
    return net.createServer((socket) => {
      this.activeSockets.add(socket)
      socket.setNoDelay(true)

      socket.once('close', () => {
        if (DEBUG_SSH) console.error(`[DIAG createForwardServer] socket closed, destroyed=${socket.destroyed}`)
        this.activeSockets.delete(socket)
      })

      socket.on('end', () => {
        if (DEBUG_SSH) console.error(`[DIAG createForwardServer] socket end received (remote closed write)`)
      })

      socket.on('error', (err) => {
        if (DEBUG_SSH) console.error(`[DIAG createForwardServer] socket error: ${err.message}`)
        socket.destroy()
      })

      if (DEBUG_SSH) console.error(`[DIAG createForwardServer] new socket connection, calling forwardOut to ${config.dstHost}:${config.dstPort}`)
      client.forwardOut(
        socket.remoteAddress ?? LOCAL_HOST,
        socket.remotePort ?? 0,
        config.dstHost,
        config.dstPort,
        (error, stream) => {
          if (error) {
            if (DEBUG_SSH) console.error(`[DIAG createForwardServer] forwardOut FAILED: ${error.message}`)
            socket.destroy(new Error(`SSH forwardOut failed: ${error.message}`))
            return
          }

          if (DEBUG_SSH) console.error(`[DIAG createForwardServer] forwardOut succeeded, socket writable=${socket.writable}, destroyed=${socket.destroyed}, readable=${socket.readable}`)
          try {
          stream.on('error', (err) => {
            if (DEBUG_SSH) console.error(`[DIAG createForwardServer] stream error: ${err.message}`)
            socket.destroy()
          })
          stream.on('close', () => {
            if (DEBUG_SSH) console.error(`[DIAG createForwardServer] stream closed`)
            socket.end()
          })
          stream.on('end', () => {
            if (DEBUG_SSH) console.error(`[DIAG createForwardServer] stream end (remote SQL closed write)`)
          })
          stream.on('data', (data: Buffer) => {
            const ok = socket.write(data)
            if (!ok) {
              stream.pause()
              socket.once('drain', () => stream.resume())
            }
          })
          socket.on('data', (data: Buffer) => {
            const ok = stream.write(data)
            if (!ok) {
              socket.pause()
              stream.once('drain', () => socket.resume())
            }
          })

          if (DEBUG_SSH) console.error(`[DIAG createForwardServer] before resume, readableLength=${socket.readableLength}`)
          socket.resume()
          if (DEBUG_SSH) console.error(`[DIAG createForwardServer] after resume, readableLength=${socket.readableLength}`)
          } catch (e: any) {
            if (DEBUG_SSH) console.error(`[DIAG createForwardServer] CAUGHT ERROR in callback: ${e?.message ?? e}`)
            socket.destroy(e)
          }
        }
      )
    })
  }

  private listenServer(server: net.Server, port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }

      const onListening = (): void => {
        server.off('error', onError)
        const address = server.address() as AddressInfo | null
        resolve(address?.port ?? port)
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, LOCAL_HOST)
    })
  }

  private attachRuntimeListeners(client: Client, server: net.Server): void {
    client.on('error', (error) => {
      if (this.client !== client) {
        return
      }
      void this.handleTunnelError(`SSH client error: ${error.message}`)
    })

    client.on('close', () => {
      if (this.client !== client) {
        return
      }
      void this.handleTunnelError('SSH client closed')
    })

    server.on('error', (error) => {
      if (this.server !== server) {
        return
      }
      void this.handleTunnelError(`SSH local forward server error: ${error.message}`)
    })
  }

  private async handleTunnelError(reason: string): Promise<void> {
    this.addLog('error', 'ssh', reason)
    this.lastError = reason
    this.lastErrorAt = Date.now()
    await this.stopInternal(reason)

    const maxAttempts = this.lastConfig?.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS
    const reconnectEnabled = this.lastConfig?.reconnectEnabled ?? true
    if (!this.manualStop && this.lastConfig?.enabled && reconnectEnabled && this.reconnectAttempts < maxAttempts) {
      this.scheduleReconnect(maxAttempts)
    }
  }

  private scheduleReconnect(maxAttempts: number): void {
    this.reconnectAttempts++
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1)

    this.status = {
      active: false,
      reconnecting: true,
      reconnectAttempt: this.reconnectAttempts,
      localHost: LOCAL_HOST,
      localPort: null,
      message: `در حال اتصال مجدد... (تلاش ${this.reconnectAttempts} از ${maxAttempts})`
    }
    this.emitStatusChanged()
    this.addLog('warn', 'ssh', `در حال اتصال مجدد... (تلاش ${this.reconnectAttempts} از ${maxAttempts})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.attemptReconnect()
    }, delay)
  }

  private async attemptReconnect(): Promise<void> {
    if (!this.lastConfig?.enabled || this.manualStop) {
      return
    }

    try {
      await this.start(this.lastConfig)
    } catch {
      const maxAttempts = this.lastConfig?.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS
      if (this.reconnectAttempts < maxAttempts) {
        this.scheduleReconnect(maxAttempts)
      } else {
        this.status = {
          active: false,
          reconnecting: false,
          reconnectAttempt: this.reconnectAttempts,
          localHost: LOCAL_HOST,
          localPort: null,
          message: `تلاش اتصال مجدد ناموفق بود (${maxAttempts} تلاش)`
        }
        this.emitStatusChanged()
        this.addLog('error', 'ssh', `تلاش اتصال مجدد ناموفق بود (${maxAttempts} تلاش)`)
      }
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private emitStatusChanged(): void {
    this.emit('status-changed', this.status)
  }

  private emitProgress(step: number, total: number, message: string, failed = false): void {
    this.emit('progress', { step, total, message, failed })
  }

  private async closeServer(server: net.Server): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) {
          return
        }
        settled = true
        resolve()
      }

      server.close(() => done())
      setTimeout(done, SHUTDOWN_TIMEOUT_MS)
    })
  }

  private async closeClient(client: Client): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) {
          return
        }
        settled = true
        resolve()
      }

      client.once('close', done)
      client.once('end', done)

      try {
        client.end()
      } catch {
        done()
      }

      setTimeout(() => {
        try {
          client.destroy()
        } catch {
          // Ignore destroy errors during shutdown
        }
        done()
      }, SHUTDOWN_TIMEOUT_MS)
    })
  }

  private async disposeTransientResources(server: net.Server | null, client: Client): Promise<void> {
    for (const socket of this.activeSockets) {
      socket.destroy()
    }
    this.activeSockets.clear()

    if (server) {
      await this.closeServer(server)
    }

    await this.closeClient(client)
  }

  private connectClient(client: Client, config: SshTunnelConfig): Promise<void> {
    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: config.readyTimeoutMs,
      keepaliveInterval: config.keepaliveIntervalMs,
      connectTimeout: config.connectTimeoutMs
    }

    if (config.privateKey.trim().length > 0) {
      connectConfig.privateKey = this.normalizePrivateKey(config.privateKey)
      if (config.passphrase.trim().length > 0) {
        connectConfig.passphrase = config.passphrase
      }
    } else {
      connectConfig.password = config.password
    }

    if (this.hostKeyStore) {
      connectConfig.hostVerifier = (key: Buffer): boolean => {
        const fingerprint = this.computeHostFingerprint(key)
        const stored = this.hostKeyStore!.getHostKey(config.host, config.port)
        if (!stored) {
          this.hostKeyStore!.saveHostKey(config.host, config.port, fingerprint)
          return true
        }
        if (fingerprint !== stored) {
          const mismatchInfo: HostKeyMismatchInfo = {
            host: config.host,
            port: config.port,
            expected: stored,
            got: fingerprint
          }
          this.emit('hostkey-mismatch', mismatchInfo)
          return false
        }
        return true
      }
    }

    return new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        cleanup()
        resolve()
      }

      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }

      const onClose = (): void => {
        cleanup()
        reject(new Error('SSH connection closed before becoming ready'))
      }

      const cleanup = (): void => {
        client.off('ready', onReady)
        client.off('error', onError)
        client.off('close', onClose)
      }

      client.on('ready', onReady)
      client.on('error', onError)
      client.on('close', onClose)
      client.connect(connectConfig)
    })
  }

  private normalizePrivateKey(privateKey: string): string {
    return privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey
  }

  private computeHostFingerprint(key: Buffer): string {
    const hash = createHash('sha256').update(key).digest('base64')
    return `SHA256:${hash}`
  }
}
