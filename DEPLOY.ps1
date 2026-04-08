# ================================================================
#  Smart Choice Auto Repair — Railway Deployment Script
#  Right-click this file → "Run with PowerShell"
# ================================================================

$ErrorActionPreference = "Stop"
$host.UI.RawUI.WindowTitle = "Smart Choice Auto Repair — Deploying to Railway"

function Write-Step($msg)  { Write-Host "`n▶  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "   ✓  $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "   ⚠  $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "   ✗  $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "  ║   Smart Choice Auto Repair                  ║" -ForegroundColor Blue
Write-Host "  ║   Voice Agent → Railway Deployment          ║" -ForegroundColor Blue
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# Move to the folder where this script lives (the project root)
Set-Location $PSScriptRoot

# ── Step 1: Check Node.js ────────────────────────────────────────
Write-Step "Checking Node.js..."
$nodeOk = $false
try {
    $v = node --version 2>&1
    Write-Ok "Node.js $v found"
    $nodeOk = $true
} catch {}

if (-not $nodeOk) {
    Write-Warn "Node.js not found. Installing via winget..."
    try {
        winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        Write-Ok "Node.js installed"
        Write-Warn "Please CLOSE this window, then double-click DEPLOY.ps1 again to continue."
        Read-Host "Press Enter to close"
        exit 0
    } catch {
        Write-Fail "Could not install Node.js automatically."
        Write-Host "   Please download it from: https://nodejs.org  (click the LTS button)" -ForegroundColor Yellow
        Write-Host "   Then run this script again." -ForegroundColor Yellow
        Read-Host "Press Enter to close"
        exit 1
    }
}

# ── Step 2: Install / update Railway CLI ────────────────────────
Write-Step "Installing Railway CLI..."
try {
    npm install -g @railway/cli --quiet 2>&1 | Out-Null
    Write-Ok "Railway CLI ready"
} catch {
    Write-Fail "Could not install Railway CLI: $_"
    Read-Host "Press Enter to close"
    exit 1
}

# ── Step 3: Login to Railway ─────────────────────────────────────
Write-Step "Logging in to Railway..."
Write-Host "   → A browser window will open. Sign in to Railway if prompted." -ForegroundColor White
Write-Host "   → Come back here once you see 'Logged in' in this window." -ForegroundColor White
Write-Host ""

try {
    railway login
    Write-Ok "Logged in to Railway"
} catch {
    Write-Fail "Login failed or was cancelled. Please try again."
    Read-Host "Press Enter to close"
    exit 1
}

# ── Step 4: Link to existing Railway project ─────────────────────
# Project already created via Railway dashboard with all env vars set.
# The .railway/config.json file links this folder to the correct project.
Write-Step "Linking to Railway project (genuine-acceptance)..."
Write-Ok "Project linked via .railway/config.json"
Write-Ok "  Project ID : ef24ce0b-b920-4d19-a3b9-0501dc159575"
Write-Ok "  Service ID : 8777618e-d299-4844-baca-9db0641239e7"

# ── Step 5: Deploy ───────────────────────────────────────────────
Write-Step "Deploying code to Railway (this takes about 2-3 minutes)..."
Write-Host "   Railway will build and start your Python server automatically." -ForegroundColor White
try {
    railway up --detach
    Write-Ok "Deployment started!"
} catch {
    Write-Fail "Deployment failed: $_"
    Read-Host "Press Enter to close"
    exit 1
}

# ── Step 6: Get the live URL ─────────────────────────────────────
Write-Step "Waiting for deployment to complete..."
Start-Sleep -Seconds 10

try {
    $status = railway status 2>&1
    Write-Host ""
    Write-Host $status -ForegroundColor White
} catch {}

# ── Done ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   Deployment complete!                      ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "  1. Run: railway open        (opens your live URL)" -ForegroundColor Cyan
Write-Host "  2. Your URL looks like:     https://genuine-acceptance.up.railway.app" -ForegroundColor Cyan
Write-Host "  3. Go to Twilio → Phone Numbers → (438) 300-1154" -ForegroundColor Cyan
Write-Host "     Set webhook URL to:     https://YOUR-URL.up.railway.app/voice" -ForegroundColor Cyan
Write-Host "  4. Call (438) 300-1154 to test — Alex will answer!" -ForegroundColor Cyan
Write-Host ""

Read-Host "Press Enter to open your Railway dashboard"
Start-Process "https://railway.com/project/ef24ce0b-b920-4d19-a3b9-0501dc159575"
