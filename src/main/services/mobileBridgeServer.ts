import { randomUUID } from 'node:crypto'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'

import type { MobileBridgeConfig, MobileBridgeStatus } from '../../shared/contracts'

const SHUTDOWN_CODE = 1001
const SHUTDOWN_REASON = 'Bridge server shutting down'
const STOP_TIMEOUT_MS = 1500

interface BridgeMessage {
  type: string
  payload?: unknown
  requestId?: string
}

type BridgeHandler = (clientId: string, socket: WebSocket, message: BridgeMessage) => void | Promise<void>

export class MobileBridgeServer {
  private server: WebSocketServer | null = null
  private readonly clients = new Map<string, WebSocket>()
  private readonly handlers = new Map<string, BridgeHandler>()
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

    const server = new WebSocketServer({ host: config.host, port: config.port, clientTracking: false })
    this.server = server

    server.on('connection', (socket) => {
      const clientId = randomUUID()
      this.clients.set(clientId, socket)
      this.status.clientCount = this.clients.size

      socket.send(
        JSON.stringify({
          type: 'bridge:hello',
          clientId,
          message: `ACC Assist WS bridge placeholder. Expected gateway domain: ${config.allowedOrigin}`
        })
      )

      socket.on('message', (message) => {
        void this.handleClientMessage(clientId, socket, message)
      })

      socket.on('close', () => {
        this.clients.delete(clientId)
        this.status.clientCount = this.clients.size
      })

      socket.on('error', (error) => {
        console.warn('[MobileBridgeServer] Client socket error:', error)
        this.clients.delete(clientId)
        this.status.clientCount = this.clients.size
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

  async stop(): Promise<void> {
    const server = this.server
    this.server = null

    for (const socket of this.clients.values()) {
      try {
        socket.close(SHUTDOWN_CODE, SHUTDOWN_REASON)
      } catch {
        socket.terminate()
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

  private async handleClientMessage(clientId: string, socket: WebSocket, rawMessage: RawData): Promise<void> {
    const message = this.parseMessage(rawMessage)

    if (!message) {
      socket.send(
        JSON.stringify({
          type: 'bridge:error',
          error: 'Invalid JSON message'
        })
      )
      return
    }

    const handler = this.handlers.get(message.type)

    if (handler) {
      await handler(clientId, socket, message)
      return
    }

    socket.send(
      JSON.stringify({
        type: 'bridge:ack',
        clientId,
        receivedType: message.type,
        payload: message.payload ?? null,
        note: 'No route handler registered yet'
      })
    )
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
