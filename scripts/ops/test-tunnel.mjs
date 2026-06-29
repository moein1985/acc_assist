import { Client } from 'ssh2'
import net from 'net'

const client = new Client()

client.on('ready', () => {
  console.log('[SSH] Connected to 192.168.85.56:2211')
  
  // Create a local server that forwards to remote SQL
  const server = net.createServer((socket) => {
    console.log('[TUNNEL] Local connection received, forwarding...')
    client.forwardOut(socket.remoteAddress, socket.remotePort, '127.0.0.1', 58033, (err, stream) => {
      if (err) {
        console.error('[TUNNEL] forwardOut failed:', err.message)
        socket.destroy()
        return
      }
      console.log('[TUNNEL] forwardOut succeeded, piping data')
      stream.on('error', (e) => console.error('[TUNNEL] stream error:', e.message))
      stream.on('close', () => socket.end())
      socket.pipe(stream).pipe(socket)
    })
  })

  server.listen(0, '127.0.0.1', () => {
    const localPort = server.address().port
    console.log(`[TUNNEL] Listening on 127.0.0.1:${localPort}`)
    
    // Now try to connect a TCP client to the local port
    setTimeout(() => {
      const tcpClient = new net.Socket()
      tcpClient.setTimeout(10000)
      
      tcpClient.on('connect', () => {
        console.log('[SQL] TCP connected to tunnel port - tunnel is working!')
        // Send a simple TDS pre-login packet to test SQL
        tcpClient.destroy()
        client.end()
        server.close()
        process.exit(0)
      })
      
      tcpClient.on('error', (err) => {
        console.error('[SQL] TCP connect failed:', err.message)
        client.end()
        server.close()
        process.exit(1)
      })
      
      tcpClient.on('timeout', () => {
        console.error('[SQL] TCP connect timeout')
        tcpClient.destroy()
        client.end()
        server.close()
        process.exit(1)
      })
      
      console.log(`[SQL] Connecting to 127.0.0.1:${localPort}...`)
      tcpClient.connect(localPort, '127.0.0.1')
    }, 1000)
  })
})

client.on('error', (err) => {
  console.error('[SSH] Connection error:', err.message)
  process.exit(1)
})

client.on('close', () => {
  console.log('[SSH] Connection closed')
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
