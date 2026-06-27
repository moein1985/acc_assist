/**
 * Schema research script — queries Sepidar01 for table and column info
 */
import { Client } from 'ssh2'

const c = new Client()

c.on('ready', () => {
  const queries = [
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='SLS' AND TABLE_NAME='InvoiceItem' ORDER BY ORDINAL_POSITION`,
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='INV' AND TABLE_NAME='InventoryReceiptItem' ORDER BY ORDINAL_POSITION`,
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='INV' AND TABLE_NAME='InventoryReceipt' ORDER BY ORDINAL_POSITION`,
    `SELECT TOP 5 * FROM INV.vwItemStockSummary WHERE FiscalYearRef=3`,
  ]

  let idx = 0
  const runNext = () => {
    if (idx >= queries.length) {
      c.end()
      return
    }
    const sql = queries[idx++]
    const label = `--- Query ${idx}: ${sql.substring(0, 80)}... ---`
    console.log(label)
    const cmd = `sqlcmd -S 127.0.0.1,58033 -U damavand -P damavand -d Sepidar01 -Q "${sql.replace(/"/g, '\\"')}" -h-1 -W`

    c.exec(cmd, (err, s) => {
      if (err) {
        console.error('Exec error:', err)
        runNext()
        return
      }
      let out = ''
      s.on('data', (d) => {
        out += d.toString()
      })
      s.stderr.on('data', (d) => {
        out += d.toString()
      })
      s.on('close', () => {
        console.log(out)
        runNext()
      })
    })
  }
  runNext()
})

c.on('error', (e) => console.error('SSH error:', e))
c.connect({
  host: '192.168.85.56',
  port: 2211,
  username: 'administrator',
  password: 'Hs-co@12321#',
  readyTimeout: 15000
})
