[CmdletBinding()]
param(
    [string]$WslDistro = $env:WATCHMAN_WSL_DISTRO,
    [string]$WslProjectPath = $env:WATCHMAN_WSL_PROJECT_PATH
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$AppDataDir = Join-Path $env:LOCALAPPDATA 'WatchmanCommand'
$LogPath = Join-Path $AppDataDir 'launcher.log'
$IconPath = Join-Path $AppDataDir 'watchman-command.ico'
$BaseUrl = 'http://127.0.0.1:8080'
$ApplicationUrl = "$BaseUrl/home"
$HealthUrl = "$BaseUrl/api/health"
$StartupTimeoutSeconds = 300
$PollIntervalSeconds = 2

New-Item -ItemType Directory -Path $AppDataDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $LogPath)) {
    New-Item -ItemType File -Path $LogPath -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $LogPath -Value "[$stamp] $Message"
}

function Show-Error {
    param([string]$Message)
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            $Message,
            'Watchman Command Launcher',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
    catch {
        Write-Error $Message
    }
    Write-Log "ERROR: $Message"
    exit 1
}

function Test-AppReady {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400)
    }
    catch {
        return $false
    }
}

function Get-WslDistro {
    param([string]$ConfiguredDistro)

    if (-not [string]::IsNullOrWhiteSpace($ConfiguredDistro)) {
        return $ConfiguredDistro
    }

    if ($env:WSL_DISTRO_NAME) {
        return $env:WSL_DISTRO_NAME
    }

    $listRaw = & wsl.exe -l -q 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $listRaw) {
        throw 'Unable to enumerate WSL distributions. Is WSL installed and running?'
    }

    $candidates = @($listRaw | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if (-not $candidates) {
        throw 'No WSL distributions were detected using wsl.exe -l -q.'
    }

    $preferred = $candidates | Where-Object { $_ -match 'Ubuntu' }
    if ($preferred) {
        return $preferred[0]
    }

    return $candidates[0]
}

function Get-WslProjectPath {
    param(
        [string]$ConfiguredPath,
        [string]$Distro
    )

    if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
        return $ConfiguredPath.TrimEnd('/')
    }

    $windowsRepoPath = Split-Path -Parent $PSScriptRoot
    $convertedPath = & wsl.exe -d $Distro -- wslpath -a -u $windowsRepoPath 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $convertedPath) {
        throw 'Unable to resolve the repository path in WSL. Set WATCHMAN_WSL_PROJECT_PATH or pass -WslProjectPath.'
    }

    return ([string]$convertedPath).Trim().TrimEnd('/')
}

function Invoke-Wsl {
    param(
        [string]$Command,
        [int]$TimeoutSec = 180
    )

    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Command))
    $job = Start-Job -ScriptBlock {
        param($distro, $encodedCommand)
        $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedCommand))
        $output = wsl.exe -d $distro -- bash -lc $decoded 2>&1
        [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output = $output
        }
    } -ArgumentList $WslDistro, $encoded

    if (-not (Wait-Job $job -Timeout $TimeoutSec)) {
        Stop-Job $job | Out-Null
        Remove-Job $job | Out-Null
        throw "wsl command timed out after ${TimeoutSec}s: $Command"
    }

    $result = Receive-Job $job
    Remove-Job $job | Out-Null

    if (-not $result) {
        return [pscustomobject]@{ ExitCode = 1; Output = @('No output returned.') }
    }

    return $result
}

function Ensure-ProjectStarted {
    $encodedStartScript = [Convert]::ToBase64String(
        [Text.Encoding]::UTF8.GetBytes([string]$WslStartScript)
    )
    $startCommand = @"
set -euo pipefail

start_script="`$(printf '%s' '$encodedStartScript' | base64 --decode)"
if [ ! -f "`$start_script" ]; then
  echo "[watchman] Missing start helper: `$start_script"
  exit 11
fi

exec bash "`$start_script"
"@

    Write-Log 'Watchman Command not reachable; attempting to start services via WSL.'

    try {
        $res = Invoke-Wsl -Command $startCommand -TimeoutSec 600
        if ($res.ExitCode -ne 0) {
            Write-Log "wsl start command failed (exit=$($res.ExitCode))"
            $snippet = ($res.Output | Select-Object -First 20) -join "`n"
            Write-Log $snippet
            throw "Project startup script failed."
        }
    }
    catch {
        throw "Unable to start Watchman Command services: $_"
    }
}

function Wait-ForReady {
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-AppReady -Url $HealthUrl) {
            Write-Log 'Watchman Command health endpoint responded successfully.'
            return $true
        }
        Start-Sleep -Seconds $PollIntervalSeconds
    }

    return $false
}

Write-Log 'Launcher started.'

if (-not (Test-Path -LiteralPath $IconPath)) {
    Write-Log "ICON_MISSING $IconPath"
} else {
    Write-Log "ICON_OK $IconPath"
}

try {
    $DetectedDistro = Get-WslDistro -ConfiguredDistro $WslDistro
    if ([string]::IsNullOrWhiteSpace($DetectedDistro)) {
        throw 'No WSL distribution could be detected.'
    }
    $WslDistro = $DetectedDistro
    Write-Log "Using WSL distribution: $WslDistro"

    $WslProjectPath = Get-WslProjectPath -ConfiguredPath $WslProjectPath -Distro $WslDistro
    $WslStartScript = "$WslProjectPath/install/start_nomad.sh"
    Write-Log "Using WSL project path: $WslProjectPath"
} catch {
    Show-Error "Cannot determine the WSL launch configuration. $_"
}

if (Test-AppReady -Url $HealthUrl) {
    Write-Log 'Application already healthy. Opening browser.'
    Start-Process -FilePath $ApplicationUrl
    exit 0
}

try {
    Ensure-ProjectStarted
} catch {
    Show-Error "Startup command failed: $($_). `nLauncher log: $LogPath"
}

if (Wait-ForReady) {
    Write-Log 'Watchman Command became healthy.'
    Start-Process -FilePath $ApplicationUrl
    exit 0
}

Show-Error "Watchman Command did not become reachable on $HealthUrl within $StartupTimeoutSeconds seconds. Check the startup log at $LogPath and run the start helper in $WslProjectPath."
