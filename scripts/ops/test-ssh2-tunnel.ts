import { Client } from 'ssh2'
import net from 'net'
import mssql from 'mssql'

const SSH_HOST = '192.168.85.56'
const SSH_PORT = 2211
const SSH_USER = 'administrator'
const SSH_PASS = 'Hs-co@12321#'
const DST_HOST = '127.0.0.1'
const DST_PORT = 58033
const LOCAL_PORT = 14331

async function main(): Promise<void> {
  console.log('[TEST] Creating SSH client...')

  const client = new Client()

  const connected = new Promise<void>((resolve, reject) => {
    client.on('ready', () => {
      console.log('[TEST] SSH client ready')
      resolve()
    })
    client.on('error', (err) => {
      console.error('[TEST] SSH client error:', err.message)
      reject(err)
    })
  })

  client.connect({
    host: SSH_HOST,
    port: SSH_PORT,
    username: SSH_USER,
    password: SSH_PASS,
    readyTimeout: 20000
  })

  await connected

  console.log('[TEST] Creating forward server...')

  const server = net.createServer((socket) => {
    console.log('[TEST] New socket connection, remoteAddress=' + socket.remoteAddress + ' remotePort=' + socket.remotePort)

    socket.on('close', () => {
      console.log('[TEST] Socket closed, destroyed=' + socket.destroyed)
    })
    socket.on('error', (err) => {
      console.error('[TEST] Socket error:', err.message)
    })

    socket.pause()
    client.forwardOut(
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      DST_HOST,
      DST_PORT,
      (err, stream) => {
        if (err) {
          console.error('[TEST] forwardOut failed:', err.message)
          socket.destroy()
          return
        }

        console.log('[TEST] forwardOut succeeded, stream writable=' + stream.writable + ' readable=' + stream.readable)

        stream.on('error', (e) => console.error('[TEST] Stream error:', e.message))
        stream.on('close', () => { console.log('[TEST] Stream closed'); socket.end() })
        stream.on('end', () => console.log('[TEST] Stream end'))
        stream.on('data', (d: Buffer) => console.log('[TEST] stream->socket ' + d.length + ' bytes: ' + d.subarray(0, 32).toString('hex')))
        socket.on('data', (d: Buffer) => console.log('[TEST] socket->stream ' + d.length + ' bytes: ' + d.subarray(0, 32).toString('hex')))

        socket.pipe(stream).pipe(socket)
        socket.resume()
      }
    )
  })

  await new Promise<void>((resolve) => {
    server.listen(LOCAL_PORT, '127.0.0.1', () => {
      console.log('[TEST] Forward server listening on 127.0.0.1:' + LOCAL_PORT)
      resolve()
    })
  })

  console.log('[TEST] Connecting mssql to 127.0.0.1:' + LOCAL_PORT + '...')

  const config: mssql.config = {
    server: '127.0.0.1',
    port: LOCAL_PORT,
    database: 'Sepidar01',
    user: 'damavand',
    password: 'damavand',
    options: {
      encrypt: false,
      trustServerCertificate: true
    },
    connectionTimeout: 15000,
    requestTimeout: 30000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 30000 }
  }

  try {
    const pool = new mssql.ConnectionPool(config)
    pool.on('error', (err) => console.error('[TEST] Pool error:', err.message))
    console.log('[TEST] Calling pool.connect()...')
    const c = await pool.connect()
    console.log('[TEST] Connected! pool.connected=' + c.connected)
    const result = await c.request().query('SELECT 1 AS ok')
    console.log('[TEST] Query result:', result.recordset)
    await pool.close()
  } catch (err) {
    const e = err as { message?: string; code?: string }
    console.error('[TEST] FAILED:', e.message, 'code=' + e.code)
  } finally {
    server.close()
    client.end()
    process.exit(0)
  }
}

main().catch(console.error)
