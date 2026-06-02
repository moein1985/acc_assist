import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket, type RawData } from 'ws'

import type { MobileBridgeConfig, MobileBridgeStatus } from '../../shared/contracts'

const SHUTDOWN_CODE = 1001
const SHUTDOWN_REASON = 'Bridge server shutting down'
const STOP_TIMEOUT_MS = 1500
const AUTH_TIMEOUT_MS = 30000

interface BridgeMessage {
  type: string
  payload?: any
  requestId?: string
}

type BridgeHandler = (clientId: string, socket: WebSocket, message: BridgeMessage) => void | Promise<void>

interface AuthenticatedClient {
  socket: WebSocket
  authenticated: boolean
  authTimer: NodeJS.Timeout
}

export class MobileBridgeServer {
  private server: WebSocketServer | null = null
  private readonly clients = new Map<string, AuthenticatedClient>()
  private readonly handlers = new Map<string, BridgeHandler>()
  private pairingCode: string | null = null
  private status: MobileBridgeStatus = {
    running: false,
    host: '127.0.0.1',
    port: 3310,
    url: 'ws://127.0.0.1:3310',
    clientCount: 0
  }

  getStatus(): MobileBridgeStatus {
    this.status.clientCount = this.clients.size
    return this.status
  }

  registerHandler(messageType: string, handler: BridgeHandler): void {
    this.handlers.set(messageType, handler)
  }

  removeHandler(messageType: string): void {
    this.handlers.delete(messageType)
  }

  async start(config: MobileBridgeConfig): Promise<MobileBridgeStatus> {
    if (!config.enabled) {
      await this.stop()
      this.status = {
        running: false,
        host: config.host,
        port: config.port,
        url: `ws://${config.host}:${config.port}`,
        clientCount: 0
      }
      return this.status
    }

    if (this.server && this.status.host === config.host && this.status.port === config.port) {
      return this.getStatus()
    }

    await this.stop()

    // Generate a fresh pairing code for this session if enabled
    this.pairingCode = Math.floor(100000 + Math.random() * 900000).toString()
    console.log(`[MobileBridgeServer] Pairing Code: ${this.pairingCode}`)

    const server = new WebSocketServer({
      host: config.host,
      port: config.port,
      clientTracking: false
    })
    this.server = server

    server.on('connection', (socket) => {
      const clientId = randomUUID()
      
      const authTimer = setTimeout(() => {
        if (this.clients.has(clientId) && !this.clients.get(clientId)?.authenticated) {
          console.log(`[MobileBridgeServer] Client ${clientId} failed to authenticate in time. Closing.`)
          socket.close(4001, 'Authentication Timeout')
          this.clients.delete(clientId)
        }
      }, AUTH_TIMEOUT_MS)

      this.clients.set(clientId, {
        socket,
        authenticated: false,
        authTimer
      })

      socket.send(
        JSON.stringify({
          type: 'bridge:hello',
          clientId,
          message: 'اتصال برقرار شد. لطفاً کد تایید را وارد کنید.'
        })
      )

      socket.on('message', (message) => {
        void this.handleClientMessage(clientId, socket, message)
      })

      socket.on('close', () => {
        const client = this.clients.get(clientId)
        if (client) clearTimeout(client.authTimer)
        this.clients.delete(clientId)
      })

      socket.on('error', (error) => {
        console.warn(`[MobileBridgeServer] Client ${clientId} error:`, error)
        const client = this.clients.get(clientId)
        if (client) clearTimeout(client.authTimer)
        this.clients.delete(clientId)
      })
    })

    server.on('error', (error) => {
      console.error('[MobileBridgeServer] Server error:', error)
    })

    await this.waitForListening(server)

    this.status = {
      running: true,
      host: config.host,
      port: config.port,
      url: `ws://${config.host}:${config.port}`,
      clientCount: this.clients.size
    }

    return this.status
  }

  getPairingCode(): string | null {
    return this.pairingCode
  }

  broadcast(message: BridgeMessage): void {
    const payload = JSON.stringify(message)
    for (const client of this.clients.values()) {
      if (client.authenticated && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(payload)
      }
    }
  }

  private async handleClientMessage(clientId: string, socket: WebSocket, raw: RawData): Promise<void> {
    try {
      const message = this.parseMessage(raw)
      const client = this.clients.get(clientId)

      if (!client || !message) return

      // Pre-auth stage: Only 'auth:pair' or 'auth:token' allowed
      if (!client.authenticated) {
        if (message.type === 'auth:pair') {
          const code = message.payload?.code
          if (code === this.pairingCode) {
            client.authenticated = true
            clearTimeout(client.authTimer)
            socket.send(JSON.stringify({ type: 'auth:success', message: 'احراز هویت با موفقیت انجام شد.' }))
            console.log(`[MobileBridgeServer] Client ${clientId} authenticated via pairing code.`)
          } else {
            socket.send(JSON.stringify({ type: 'auth:fail', message: 'کد تایید اشتباه است.' }))
          }
          return
        }
        
        socket.send(JSON.stringify({ type: 'auth:error', message: 'لطفاً ابتدا احراز هویت کنید.' }))
        return
      }

      // Authenticated stage: Route to handlers
      const handler = this.handlers.get(message.type)
      if (handler) {
        await handler(clientId, socket, message)
      } else {
        socket.send(JSON.stringify({ type: 'bridge:error', message: `هندلری برای ${message.type} وجود ندارد.` }))
      }
    } catch (error) {
      console.error('[MobileBridgeServer] Message handling error:', error)
    }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null

    for (const client of this.clients.values()) {
      clearTimeout(client.authTimer)
      try {
        client.socket.close(SHUTDOWN_CODE, SHUTDOWN_REASON)
      } catch {
        client.socket.terminate()
      }
    }
    this.clients.clear()

    if (server) {
      await this.closeServer(server)
    }

    this.status = {
      ...this.status,
      running: false,
      clientCount: 0
    }
  }

  private waitForListening(server: WebSocketServer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        cleanup()
        resolve()
      }

      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }

      const cleanup = (): void => {
        server.off('listening', onListening)
        server.off('error', onError)
      }

      server.on('listening', onListening)
      server.on('error', onError)
    })
  }

  private async closeServer(server: WebSocketServer): Promise<void> {
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
      setTimeout(done, STOP_TIMEOUT_MS)
    })
  }

  private parseMessage(rawMessage: RawData): BridgeMessage | null {
    try {
      const text = Buffer.isBuffer(rawMessage) ? rawMessage.toString('utf8') : rawMessage.toString()
      const parsed = JSON.parse(text) as Partial<BridgeMessage>

      if (!parsed.type || typeof parsed.type !== 'string') {
        return null
      }

      return {
        type: parsed.type,
        payload: parsed.payload,
        requestId: typeof parsed.requestId === 'string' ? parsed.requestId : undefined
      }
    } catch {
      return null
    }
  }
}
