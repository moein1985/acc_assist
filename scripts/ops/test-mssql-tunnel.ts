import mssql from 'mssql'

const LOCAL_PORT = 14331
const SQL_USER = 'damavand'
const SQL_PASS = 'damavand'
const SQL_DB = 'Sepidar01'

async function main(): Promise<void> {
  console.log('[TEST] Connecting to 127.0.0.1:' + LOCAL_PORT + ' via mssql...')

  const config: mssql.config = {
    server: '127.0.0.1',
    port: LOCAL_PORT,
    database: SQL_DB,
    user: SQL_USER,
    password: SQL_PASS,
    options: {
      encrypt: false,
      trustServerCertificate: true
    },
    connectionTimeout: 15000,
    requestTimeout: 30000,
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 30000
    }
  }

  try {
    const pool = new mssql.ConnectionPool(config)
    pool.on('error', (err) => {
      console.error('[TEST] Pool error:', err.message)
    })
    console.log('[TEST] Calling pool.connect()...')
    const connected = await pool.connect()
    console.log('[TEST] Connected! pool.connected=' + connected.connected)
    const result = await connected.request().query('SELECT 1 AS ok')
    console.log('[TEST] Query result:', result.recordset)
    await pool.close()
    console.log('[TEST] Done')
  } catch (err) {
    const e = err as { message?: string; code?: string; originalError?: { message?: string; code?: string } }
    console.error('[TEST] FAILED:', e.message, 'code=' + e.code, 'originalError=' + JSON.stringify(e.originalError))
  }
}

main().catch(console.error)
