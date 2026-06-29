const fs = require('fs')
const c = fs.readFileSync('node_modules/mssql/lib/tedious/connection-pool.js', 'utf8')
const lines = c.split('\n')
lines.forEach((l, i) => {
  console.log((i + 1) + ': ' + l.trim().substring(0, 120))
})
