@echo off
REM ════════════════════════════════════════════════════════════════════
REM  Clean up old git and deploy fresh
REM ════════════════════════════════════════════════════════════════════

color 0A
title Fund Tracking - Clean Deploy

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║   🧹 CLEANUP & FRESH DEPLOYMENT                               ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

echo [1/8] Cleaning up old git files...
REM Remove .git folder if it exists
if exist ".git" (
    echo   Removing .git folder...
    rmdir /s /q .git
    if errorlevel 1 (
        echo ❌ Could not remove .git folder
        echo Try: Right-click .git folder → Delete
        pause
        exit /b 1
    )
    echo ✓ Old git removed
) else (
    echo ✓ No old git folder found
)
echo.

REM Remove git lock file if it exists
if exist ".git\config.lock" (
    echo   Removing git lock file...
    del /f /q ".git\config.lock" 2>nul
)
echo.

REM Check if git is installed
echo [2/8] Checking git installation...
git --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: Git is not installed or not in PATH
    echo Please install Git from: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo ✓ Git found
echo.

REM Initialize fresh git
echo [3/8] Initializing fresh Git repository...
git init --initial-branch=main
if errorlevel 1 (
    echo ❌ Failed to initialize git
    echo Try running this as Administrator
    pause
    exit /b 1
)
echo ✓ Git initialized
echo.

REM Configure git user
echo [4/8] Configuring Git user...
git config user.email "nuparkjr@gmail.com"
git config user.name "Nupark Jiravinyu"
echo ✓ Git configured
echo.

REM Add files
echo [5/8] Adding files to git...
git add .
echo ✓ Files added
echo.

REM Create commit
echo [6/8] Creating commit...
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
echo [7/8] Adding GitHub remote...
git remote add origin https://github.com/moborarl/Fund-tracking.git
echo ✓ Remote added
echo.

REM Push to GitHub
echo [8/8] Pushing to GitHub...
echo.
echo ⚠️  IMPORTANT: When prompted for credentials:
echo    - Username: Your GitHub username
echo    - Password: Your Personal Access Token (NOT your password!)
echo.
echo Get token at: https://github.com/settings/tokens
echo Generate → "Generate new token (classic)"
echo Select scope: "repo"
echo.
pause

git push -u origin main

if errorlevel 1 (
    echo.
    echo ❌ Push failed
    echo Possible issues:
    echo   - Wrong GitHub token
    echo   - No internet connection
    echo   - Token expired
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
echo    4. Build settings: No build command needed
echo    5. Deploy!
echo.
pause
