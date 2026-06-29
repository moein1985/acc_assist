const fs = require('fs')
const c = fs.readFileSync('out/main/index.js', 'utf8')

const checks = [
  'require("mssql")',
  'require("ssh2")',
  'require("tedious")',
  'require("net")',
  'forwardOut',
  'createForwardServer',
  'ConnectionPool',
  'new tds.Connection',
  'tedious'
]

checks.forEach(s => {
  const idx = c.indexOf(s)
  console.log(s + ' => ' + (idx >= 0 ? 'FOUND at ' + idx : 'NOT FOUND'))
})

// Check if mssql/ssh2 are externalized (require calls) or bundled (inline code)
const requireCount = (c.match(/require\(/g) || []).length
console.log('\\nTotal require() calls:', requireCount)

// Check file size
const stats = fs.statSync('out/main/index.js')
console.log('File size:', (stats.size / 1024).toFixed(1) + ' KB')
