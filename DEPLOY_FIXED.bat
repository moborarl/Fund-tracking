@echo off
REM ════════════════════════════════════════════════════════════════════
REM  Fund Tracking Dashboard - GitHub Deployment (Fixed)
REM ════════════════════════════════════════════════════════════════════

color 0A
title Fund Tracking - Deploy to GitHub

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║   🚀 FUND TRACKING DASHBOARD - GITHUB DEPLOYMENT              ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

REM Check if git is installed
git --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: Git is not installed
    pause
    exit /b 1
)

echo ✓ Git found
echo.

REM Git already initialized, just check status
echo [1/5] Checking git status...
git status
echo.

REM Configure git user
echo [2/5] Configuring Git user...
git config user.email "nuparkjr@gmail.com"
git config user.name "Nupark Jiravinyu"
git config --list | findstr /i "user"
echo ✓ Git configured
echo.

REM Add files
echo [3/5] Adding files to git...
git add .
echo ✓ Files staged
echo.

REM Create commit (simple message - avoid batch multiline issues)
echo [4/5] Creating commit...
git commit -m "Initial commit: Fund tracking dashboard for Cloudflare Pages"
if errorlevel 1 (
    echo Note: Commit may already exist (that's OK)
)
echo ✓ Commit ready
echo.

REM Check if remote exists, if not add it
echo [5/5] Setting up GitHub remote...
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo   Adding new remote...
    git remote add origin https://github.com/moborarl/Fund-tracking.git
) else (
    echo   Remote already exists, skipping...
)
echo ✓ Remote configured
echo.

REM Push to GitHub
echo ════════════════════════════════════════════════════════════════
echo 🔐 ENTERING GITHUB CREDENTIALS...
echo.
echo When prompted:
echo   - Username: Your GitHub username
echo   - Password: Your Personal Access Token
echo.
echo Get token: https://github.com/settings/tokens
echo ════════════════════════════════════════════════════════════════
echo.
pause

git push -u origin main

if errorlevel 1 (
    echo.
    echo ❌ Push failed!
    echo Check:
    echo   - Internet connection
    echo   - GitHub token (not password!)
    echo   - Token not expired
    echo.
    echo Try manually:
    echo   git push -u origin main
    echo.
    pause
    exit /b 1
)

echo.
echo ════════════════════════════════════════════════════════════════
echo ✅ SUCCESS! Pushed to GitHub!
echo ════════════════════════════════════════════════════════════════
echo.
echo 📊 GitHub:
echo    https://github.com/moborarl/Fund-tracking
echo.
echo 🌐 Next step: Cloudflare Pages
echo    1. https://dash.cloudflare.com/
echo    2. Pages → Create project
echo    3. Connect GitHub → moborarl/Fund-tracking
echo    4. Deploy!
echo.
echo Your dashboard will be live at: fund-tracking.pages.dev
echo.
pause
