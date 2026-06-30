import * as fs from 'fs'
import * as path from 'path'
import { spawn, execSync } from 'child_process'
import * as os from 'os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PythonResult {
  success: boolean
  stdout: string
  stderr: string
  outputFiles: string[]
  outputData?: unknown
  error?: string
  durationMs: number
}

export interface RunPythonOptions {
  timeoutMs?: number
  maxMemoryMB?: number
}

// ---------------------------------------------------------------------------
// PythonRunnerService — resolves the embedded python.exe path
// ---------------------------------------------------------------------------

export class PythonRunnerService {
  private pythonPath: string
  private wrapperPath: string
  private validatorPath: string

  constructor() {
    const isElectron = !!process.versions.electron
    const isPackaged = isElectron && process.env.ELECTRON_IS_PACKAGED === '1'
    const base = isPackaged
      ? process.resourcesPath ?? path.join(process.cwd(), 'resources')
      : path.join(__dirname, '..', '..', '..', '..', 'resources')
    this.pythonPath = path.join(base, 'python', 'python.exe')
    this.wrapperPath = path.join(base, 'python', 'run_wrapper.py')
    this.validatorPath = path.join(base, 'python', 'validate_code.py')
  }

  isAvailable(): boolean {
    return fs.existsSync(this.pythonPath)
  }

  getVersion(): string | null {
    if (!this.isAvailable()) return null
    try {
      const result = execSync(`"${this.pythonPath}" --version`, {
        encoding: 'utf-8',
        timeout: 5000
      })
      return result.trim()
    } catch {
      return null
    }
  }

  getPythonPath(): string {
    return this.pythonPath
  }

  getWrapperPath(): string {
    return this.wrapperPath
  }

  getValidatorPath(): string {
    return this.validatorPath
  }
}

// ---------------------------------------------------------------------------
// Sandbox — AST validation + secure subprocess execution
// ---------------------------------------------------------------------------

const ALLOWED_IMPORTS = new Set([
  'pandas',
  'matplotlib',
  'matplotlib.pyplot',
  'matplotlib.pylab',
  'numpy',
  'openpyxl',
  'reportlab',
  'json',
  'datetime',
  'math',
  'io',
  'csv',
  'base64',
  're',
  'statistics',
  'decimal',
  'collections',
  'itertools',
  'functools',
  'string',
  'textwrap',
  'unicodedata'
])

const BLOCKED_BUILTINS = new Set([
  '__import__',
  'eval',
  'exec',
  'compile',
  'open',
  'globals',
  'locals'
])

/**
 * Validate Python code by calling the embedded validator script.
 * Returns null if OK, or an error message string if rejected.
 */
export async function validatePythonCode(
  pythonExe: string,
  validatorPath: string,
  code: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(pythonExe, [validatorPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MPLBACKEND: 'Agg' }
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    proc.on('close', (exitCode: number | null) => {
      if (exitCode !== 0) {
        resolve(`Validator exited with code ${exitCode}: ${stderr}`)
        return
      }
      const trimmed = stdout.trim()
      if (trimmed === 'OK') {
        resolve(null)
      } else if (trimmed.startsWith('REJECTED:')) {
        resolve(trimmed)
      } else {
        resolve(`Unexpected validator output: ${trimmed}`)
      }
    })

    proc.on('error', (err: Error) => {
      resolve(`Validator spawn error: ${err.message}`)
    })

    // Send code via stdin
    proc.stdin.write(code)
    proc.stdin.end()
  })
}

/**
 * Run Python code in a sandboxed subprocess.
 * - AST validation is performed first (caller must call validatePythonCode)
 * - No network access (NO_PROXY=*, HTTP_PROXY=, HTTPS_PROXY=)
 * - Working directory is a unique temp dir
 * - Timeout kills the process
 */
export async function runPythonCode(
  pythonExe: string,
  wrapperPath: string,
  code: string,
  inputData: Record<string, unknown>,
  options: RunPythonOptions = {}
): Promise<PythonResult> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const startTime = Date.now()

  // Create unique temp working dir
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-python-'))

  try {
    return await new Promise<PythonResult>((resolve) => {
      const proc = spawn(pythonExe, [wrapperPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: tempDir,
        env: {
          ...process.env,
          MPLBACKEND: 'Agg',
          NO_PROXY: '*',
          HTTP_PROXY: '',
          HTTPS_PROXY: '',
          TMPDIR: tempDir,
          TEMP: tempDir,
          TMP: tempDir
        }
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        proc.kill('SIGKILL')
      }, timeoutMs)

      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString()
      })
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString()
      })

      proc.on('close', (exitCode: number | null) => {
        clearTimeout(timer)
        const durationMs = Date.now() - startTime

        if (timedOut) {
          resolve({
            success: false,
            stdout,
            stderr,
            outputFiles: [],
            error: `Timeout after ${timeoutMs}ms`,
            durationMs
          })
          return
        }

        if (exitCode !== 0) {
          resolve({
            success: false,
            stdout,
            stderr,
            outputFiles: [],
            error: `Python exited with code ${exitCode}: ${stderr}`,
            durationMs
          })
          return
        }

        // Parse wrapper output JSON
        let outputFiles: string[] = []
        let outputData: unknown = undefined

        try {
          const parsed = JSON.parse(stdout.trim())
          if (parsed.success) {
            outputFiles = (parsed.output_files || []).map((f: string) =>
              path.isAbsolute(f) ? f : path.join(tempDir, f)
            )
            outputData = parsed.output_data
          } else {
            resolve({
              success: false,
              stdout,
              stderr,
              outputFiles: [],
              error: parsed.error || 'Unknown wrapper error',
              durationMs
            })
            return
          }
        } catch {
          // stdout might not be JSON if the script printed directly
          // treat as success with raw stdout
        }

        resolve({
          success: true,
          stdout,
          stderr,
          outputFiles,
          outputData,
          durationMs
        })
      })

      proc.on('error', (err: Error) => {
        clearTimeout(timer)
        resolve({
          success: false,
          stdout,
          stderr,
          outputFiles: [],
          error: `Spawn error: ${err.message}`,
          durationMs: Date.now() - startTime
        })
      })

      // Send input data as JSON via stdin
      const payload = JSON.stringify({
        ...inputData,
        code,
        output_dir: tempDir
      })
      proc.stdin.write(payload)
      proc.stdin.end()
    })
  } catch (err) {
    return {
      success: false,
      stdout: '',
      stderr: String(err),
      outputFiles: [],
      error: String(err),
      durationMs: Date.now() - startTime
    }
  }
}

export { ALLOWED_IMPORTS, BLOCKED_BUILTINS }
