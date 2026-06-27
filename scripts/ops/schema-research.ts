/**
 * Schema research script — queries Sepidar01 for table and column info
 */
import { Client } from 'ssh2'

const c = new Client()

c.on('ready', () => {
  const queries = [
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='GNR' AND TABLE_NAME='CostCenter' ORDER BY ORDINAL_POSITION`,
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ACC' AND TABLE_NAME='DL' ORDER BY ORDINAL_POSITION`,
    `SELECT TOP 3 * FROM GNR.CostCenter`,
    `SELECT TOP 5 DLId, Code, Title, Type FROM ACC.DL`,
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
