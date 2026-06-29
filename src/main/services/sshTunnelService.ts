import net, { type AddressInfo } from 'node:net'
import { EventEmitter } from 'node:events'
import { Client, type ConnectConfig } from 'ssh2'

import type { SshTunnelConfig, SshTunnelStatus } from '../../shared/contracts'

const LOCAL_HOST = '127.0.0.1'
const SHUTDOWN_TIMEOUT_MS = 1500
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_BASE_DELAY_MS = 1000

export type SshTunnelEvent = 'status-changed'

export class SshTunnelService extends EventEmitter {
  private client: Client | null = null
  private server: net.Server | null = null
  private readonly activeSockets = new Set<net.Socket>()
  private stopPromise: Promise<SshTunnelStatus> | null = null
  private lastConfig: SshTunnelConfig | null = null
  private manualStop = false
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
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

  async start(config: SshTunnelConfig): Promise<SshTunnelStatus> {
    if (!config.enabled) {
      await this.stop('SSH tunnel is disabled by settings')
      return this.status
    }

    this.manualStop = false
    this.reconnectAttempts = 0
    this.clearReconnectTimer()
    this.lastConfig = config

    this.validateConfig(config)
    await this.stop('Restarting tunnel with new configuration')

    const client = new Client()
    let server: net.Server | null = null

    try {
      await this.connectClient(client, config)

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

      return this.status
    } catch (error) {
      await this.disposeTransientResources(server, client)
      const message = error instanceof Error ? error.message : String(error)
      const persianMessage = this.translateSshError(message)
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
    return message
  }

  async stop(message = 'Tunnel stopped'): Promise<SshTunnelStatus> {
    this.manualStop = true
    this.clearReconnectTimer()
    this.reconnectAttempts = 0

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

  private createForwardServer(client: Client, config: SshTunnelConfig): net.Server {
    return net.createServer((socket) => {
      this.activeSockets.add(socket)
      socket.setNoDelay(true)

      socket.once('close', () => {
        this.activeSockets.delete(socket)
      })

      socket.on('error', () => {
        socket.destroy()
      })

      client.forwardOut(
        socket.remoteAddress ?? LOCAL_HOST,
        socket.remotePort ?? 0,
        config.dstHost,
        config.dstPort,
        (error, stream) => {
          if (error) {
            socket.destroy(new Error(`SSH forwardOut failed: ${error.message}`))
            return
          }

          stream.setNoDelay(true)
          stream.on('error', () => socket.destroy())
          stream.on('close', () => socket.end())

          socket.pipe(stream).pipe(socket)
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
    await this.stopInternal(reason)

    if (!this.manualStop && this.lastConfig?.enabled && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1)

    this.status = {
      active: false,
      reconnecting: true,
      reconnectAttempt: this.reconnectAttempts,
      localHost: LOCAL_HOST,
      localPort: null,
      message: `در حال اتصال مجدد... (تلاش ${this.reconnectAttempts} از ${MAX_RECONNECT_ATTEMPTS})`
    }
    this.emitStatusChanged()

    this.clearReconnectTimer()
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
      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.scheduleReconnect()
      } else {
        this.status = {
          active: false,
          reconnecting: false,
          reconnectAttempt: this.reconnectAttempts,
          localHost: LOCAL_HOST,
          localPort: null,
          message: `تلاش اتصال مجدد ناموفق بود (${MAX_RECONNECT_ATTEMPTS} تلاش)`
        }
        this.emitStatusChanged()
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
      keepaliveInterval: config.keepaliveIntervalMs
    }

    if (config.privateKey.trim().length > 0) {
      connectConfig.privateKey = this.normalizePrivateKey(config.privateKey)
      if (config.passphrase.trim().length > 0) {
        connectConfig.passphrase = config.passphrase
      }
    } else {
      connectConfig.password = config.password
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
}
