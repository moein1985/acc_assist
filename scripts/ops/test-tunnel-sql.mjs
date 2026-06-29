import { Client } from 'ssh2'
import net from 'net'
import mssql from 'mssql'

const client = new Client()

client.on('ready', () => {
  console.log('[SSH] Connected to 192.168.85.56:2211')
  
  const server = net.createServer((socket) => {
    client.forwardOut(socket.remoteAddress, socket.remotePort, '127.0.0.1', 58033, (err, stream) => {
      if (err) {
        console.error('[TUNNEL] forwardOut failed:', err.message)
        socket.destroy()
        return
      }
      stream.on('error', (e) => console.error('[TUNNEL] stream error:', e.message))
      stream.on('close', () => socket.end())
      socket.pipe(stream).pipe(socket)
    })
  })

  server.listen(0, '127.0.0.1', async () => {
    const localPort = server.address().port
    console.log(`[TUNNEL] Listening on 127.0.0.1:${localPort}`)
    
    // Wait a moment for tunnel to stabilize
    await new Promise(r => setTimeout(r, 1000))
    
    // Try mssql connection through the tunnel
    console.log('[SQL] Connecting mssql to 127.0.0.1:' + localPort + '...')
    try {
      const pool = new mssql.ConnectionPool({
        server: '127.0.0.1',
        database: 'Sepidar01',
        user: 'damavand',
        password: 'damavand',
        port: localPort,
        options: {
          encrypt: false,
          trustServerCertificate: true
        },
        connectionTimeout: 15000,
        requestTimeout: 45000,
        pool: {
          max: 8,
          min: 1,
          idleTimeoutMillis: 120000
        }
      })
      
      await pool.connect()
      console.log('[SQL] Connected successfully!')
      
      const result = await pool.request().query('SELECT 1 AS ok, DB_NAME() AS db')
      console.log('[SQL] Query result:', result.recordset[0])
      
      await pool.close()
      console.log('[SQL] Connection closed')
    } catch (err) {
      console.error('[SQL] Connection failed:', err.message)
      if (err.code) console.error('[SQL] Error code:', err.code)
    }
    
    client.end()
    server.close()
    process.exit(0)
  })
})

client.on('error', (err) => {
  console.error('[SSH] Connection error:', err.message)
  process.exit(1)
})

console.log('[SSH] Connecting to 192.168.85.56:2211 as administrator...')
client.connect({
  host: '192.168.85.56',
  port: 2211,
  username: 'administrator',
  password: 'Hs-co@12321#',
  readyTimeout: 20000,
  connectTimeout: 15000
})
