const { execSync } = require('child_process')
const path = require('path')

const electronPath = path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe')
const scriptPath = path.join(__dirname, 'test-electron-tunnel.js')

try {
  const out = execSync(`"${electronPath}" "${scriptPath}"`, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 30000,
    encoding: 'utf8',
    cwd: path.join(__dirname, '..', '..')
  })
  console.log(out)
} catch (err) {
  console.error('Error:', err.message)
  if (err.stdout) console.log('stdout:', err.stdout)
  if (err.stderr) console.log('stderr:', err.stderr)
}
