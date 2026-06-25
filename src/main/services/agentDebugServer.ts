import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import type { AgentProgressEvent, AgentSendMessageRequest, AgentSendMessageResult } from '../../shared/contracts'

type AgentDebugServerOptions = {
  host: string
  port: number
  token: string
  sendMessage: (
    payload: AgentSendMessageRequest,
    onProgress: (event: AgentProgressEvent) => void
  ) => Promise<AgentSendMessageResult>
}

type AskPayload = {
  prompt?: string
  promptBase64?: string
  requestId?: string
  conversationId?: string
  mode?: 'manual' | 'dry-run'
}

const STOP_TIMEOUT_MS = 1500

/**
 * Decodes an incoming prompt, forcing UTF-8 semantics regardless of the
 * SSH/console codepage used by the caller. When `promptBase64` is supplied it is
 * the authoritative source (base64 of UTF-8 bytes) and is preferred over the
 * plain `prompt` field, which can be mangled by intermediate single-byte
 * codepages. Returns the trimmed prompt or an empty string when absent/invalid.
 */
export function resolveUtf8Prompt(payload: AskPayload): string {
  const base64 = payload.promptBase64?.trim()
  if (base64) {
    try {
      const decoded = Buffer.from(base64, 'base64').toString('utf8').trim()
      if (decoded) {
        return decoded
      }
    } catch {
      // Fall back to the plain prompt field below.
    }
  }

  return payload.prompt?.trim() ?? ''
}

export class AgentDebugServer {
  private server: ReturnType<typeof createServer> | null = null

  async start(options: AgentDebugServerOptions): Promise<void> {
    await this.stop()

    this.server = createServer(async (req, res) => {
      try {
        if (!this.authorize(req, options.token)) {
          this.json(res, 401, { error: 'unauthorized' })
          return
        }

        if (req.method === 'GET' && req.url === '/health') {
          this.json(res, 200, { ok: true })
          return
        }

        if (req.method === 'POST' && req.url === '/ask') {
          const payload = (await this.readJsonBody(req)) as AskPayload
          const prompt = resolveUtf8Prompt(payload)

          if (!prompt) {
            this.json(res, 400, { error: 'prompt is required' })
            return
          }

          const requestId = payload.requestId?.trim() || `ssh-${Date.now()}`
          const conversationId = payload.conversationId?.trim() || 'ssh-debug'
          const mode = payload.mode === 'dry-run' ? 'dry-run' : 'manual'
          const progress: AgentProgressEvent[] = []

          const result = await options.sendMessage(
            {
              requestId,
              conversationId,
              prompt,
              mode,
              history: []
            },
            (event) => {
              progress.push(event)
            }
          )

          this.json(res, 200, {
            ok: true,
            requestId,
            conversationId,
            result,
            progress
          })
          return
        }

        this.json(res, 404, { error: 'not-found' })
      } catch (error) {
        this.json(res, 500, {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })

    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        cleanup()
        resolve()
      }

      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }

      const cleanup = (): void => {
        this.server?.off('listening', onListening)
        this.server?.off('error', onError)
      }

      this.server?.on('listening', onListening)
      this.server?.on('error', onError)
      this.server?.listen(options.port, options.host)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return
    }

    const server = this.server
    this.server = null

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

  private authorize(req: IncomingMessage, token: string): boolean {
    const provided = req.headers['x-debug-token']
    return typeof provided === 'string' && provided.trim() === token
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []

    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const raw = Buffer.concat(chunks).toString('utf8').trim()
    if (!raw) {
      return {}
    }

    return JSON.parse(raw) as unknown
  }

  private json(res: ServerResponse, statusCode: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body)
    })
    res.end(body)
  }
}
