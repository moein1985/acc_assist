# install-python-deps.ps1 — Install Python libraries for embedded Python in resources/python/
# Usage: .\scripts\ops\install-python-deps.ps1
#
# Tries international PyPI first, falls back to Iranian mirror (pypi.ir) if blocked.

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$pythonExe = Join-Path $projectRoot "resources\python\python.exe"
$sitePackages = Join-Path $projectRoot "resources\python\Lib\site-packages"

if (!(Test-Path $pythonExe)) {
    Write-Error "python.exe not found at $pythonExe"
    Write-Host "Run S18.1 first to download Python embedded."
    exit 1
}

if (!(Test-Path $sitePackages)) {
    New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null
}

$packages = @("pandas", "matplotlib", "openpyxl", "reportlab", "numpy")

Write-Host "Installing packages: $($packages -join ', ')"
Write-Host "Target: $sitePackages"
Write-Host ""

# Try international repo first
Write-Host "[1/2] Trying international repo (pypi.org)..."
$exitCode = 0
try {
    & $pythonExe -m pip install --target $sitePackages $packages -i https://pypi.org/simple --no-warn-script-location 2>&1 | ForEach-Object { Write-Host $_ }
    $exitCode = $LASTEXITCODE
} catch {
    $exitCode = 1
}

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "[1/2] International repo failed (exit code: $exitCode)."
    Write-Host "[2/2] Trying Iranian repo (pypi.ir)..."
    & $pythonExe -m pip install --target $sitePackages $packages -i https://pypi.ir/simple --trusted-host pypi.ir --no-warn-script-location 2>&1 | ForEach-Object { Write-Host $_ }
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Error "Both repos failed. Cannot install Python dependencies."
        exit 1
    }
    Write-Host "[2/2] Iranian repo succeeded."
} else {
    Write-Host "[1/2] International repo succeeded."
}

# Set matplotlib backend to Agg (non-interactive)
$matplotlibrc = Get-ChildItem $sitePackages -Recurse -Filter "matplotlibrc" | Select-Object -First 1
if ($matplotlibrc) {
    $content = Get-Content $matplotlibrc.FullName -Raw
    if ($content -match 'backend:\s*\S+') {
        $content = $content -replace 'backend:\s*\S+', 'backend: Agg'
    } else {
        $content = "backend: Agg`n" + $content
    }
    Set-Content -Path $matplotlibrc.FullName -Value $content -NoNewline
    Write-Host "matplotlibrc updated: backend = Agg"
}

# Verify
Write-Host ""
Write-Host "Verifying imports..."
& $pythonExe -c "import pandas, matplotlib, openpyxl, reportlab, numpy; print('matplotlib backend:', matplotlib.get_backend()); print('All imports OK')"
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "SUCCESS: All Python dependencies installed."
} else {
    Write-Error "Import verification failed."
    exit 1
}
