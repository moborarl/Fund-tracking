@echo off
REM ════════════════════════════════════════════════════════════════════
REM  Fund Tracking Dashboard - Automated GitHub Deployment Script
REM  Windows Batch File
REM ════════════════════════════════════════════════════════════════════

color 0A
title Fund Tracking Dashboard - GitHub Deployment

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║   🚀 FUND TRACKING DASHBOARD - GITHUB DEPLOYMENT              ║
echo ║   Auto-setup for Cloudflare Pages                            ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

REM Check if git is installed
git --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: Git is not installed or not in PATH
    echo.
    echo Please install Git from: https://git-scm.com/download/win
    echo Then run this script again
    pause
    exit /b 1
)

echo ✓ Git found
echo.

REM Initialize git
echo [1/7] Initializing Git repository...
git init --initial-branch=main
if errorlevel 1 (
    echo ❌ Failed to initialize git
    pause
    exit /b 1
)
echo ✓ Git initialized
echo.

REM Configure git user
echo [2/7] Configuring Git user...
git config user.email "nuparkjr@gmail.com"
git config user.name "Nupark Jiravinyu"
echo ✓ Git configured
echo.

REM Check status
echo [3/7] Checking files...
git status
echo ✓ Files ready
echo.

REM Add files
echo [4/7] Adding files to git...
git add .
echo ✓ Files added
echo.

REM Create commit
echo [5/7] Creating commit...
git commit -m "Initial commit: Fund tracking dashboard for Cloudflare Pages

- Multi-AMC portfolio monitor (65 mutual funds)
- Dark-themed responsive HTML dashboard
- Chart.js visualizations
- Complete documentation
- Professional financial UI
- Ready for Cloudflare Pages deployment"

if errorlevel 1 (
    echo ❌ Failed to create commit
    pause
    exit /b 1
)
echo ✓ Commit created
echo.

REM Add remote
echo [6/7] Adding GitHub remote...
git remote add origin https://github.com/moborarl/Fund-tracking.git
echo ✓ Remote added
echo.

REM Push to GitHub
echo [7/7] Pushing to GitHub...
echo.
echo ⚠️  IMPORTANT: When prompted for credentials:
echo    - Username: Your GitHub username
echo    - Password: Your Personal Access Token (NOT your password!)
echo.
echo Get token at: https://github.com/settings/tokens
echo Generate → "Generate new token (classic)"
echo Select scope: "repo" (full control)
echo.
pause

git push -u origin main

if errorlevel 1 (
    echo.
    echo ❌ Push failed. Check your GitHub credentials.
    echo    Make sure you used a Personal Access Token, not your password.
    echo.
    pause
    exit /b 1
)

echo.
echo ════════════════════════════════════════════════════════════════
echo ✅ SUCCESS! Repository pushed to GitHub
echo ════════════════════════════════════════════════════════════════
echo.
echo 📊 GitHub Repository:
echo    https://github.com/moborarl/Fund-tracking
echo.
echo 🌐 Next: Connect to Cloudflare Pages
echo    1. Go to: https://dash.cloudflare.com/
echo    2. Pages → Create a project
echo    3. Connect to Git → Select moborarl/Fund-tracking
echo    4. Build settings:
echo       - Build command: (leave empty)
echo       - Output directory: . (dot)
echo    5. Deploy!
echo.
echo 📖 For details, read: DEPLOYMENT_CHECKLIST.md
echo.
pause
