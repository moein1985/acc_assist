const fs = require('fs')
const c = fs.readFileSync('node_modules/tedious/lib/connector.js', 'utf8')
console.log(c)
