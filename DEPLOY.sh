#!/bin/bash

#════════════════════════════════════════════════════════════════════
# Fund Tracking Dashboard - Automated GitHub Deployment Script
# Mac/Linux Bash Script
#════════════════════════════════════════════════════════════════════

set -e  # Exit on error

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   🚀 FUND TRACKING DASHBOARD - GITHUB DEPLOYMENT              ║"
echo "║   Auto-setup for Cloudflare Pages                            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ ERROR: Git is not installed"
    echo ""
    echo "Install Git:"
    echo "  Mac:   brew install git"
    echo "  Linux: apt-get install git"
    exit 1
fi

echo "✓ Git found: $(git --version)"
echo ""

# Initialize git
echo "[1/7] Initializing Git repository..."
git init --initial-branch=main
echo "✓ Git initialized"
echo ""

# Configure git user
echo "[2/7] Configuring Git user..."
git config user.email "nuparkjr@gmail.com"
git config user.name "Nupark Jiravinyu"
echo "✓ Git configured"
echo ""

# Check status
echo "[3/7] Checking files..."
git status
echo "✓ Files ready"
echo ""

# Add files
echo "[4/7] Adding files to git..."
git add .
echo "✓ Files added"
echo ""

# Create commit
echo "[5/7] Creating commit..."
git commit -m "Initial commit: Fund tracking dashboard for Cloudflare Pages

- Multi-AMC portfolio monitor (65 mutual funds)
- Dark-themed responsive HTML dashboard
- Chart.js visualizations
- Complete documentation
- Professional financial UI
- Ready for Cloudflare Pages deployment"

echo "✓ Commit created"
echo ""

# Add remote
echo "[6/7] Adding GitHub remote..."
git remote add origin https://github.com/moborarl/Fund-tracking.git
echo "✓ Remote added"
echo ""

# Push to GitHub
echo "[7/7] Pushing to GitHub..."
echo ""
echo "⚠️  IMPORTANT: When prompted for credentials:"
echo "   - Username: Your GitHub username"
echo "   - Password: Your Personal Access Token (NOT your password!)"
echo ""
echo "Get token at: https://github.com/settings/tokens"
echo "Generate → 'Generate new token (classic)'"
echo "Select scope: 'repo' (full control)"
echo ""
echo "Press Enter to continue..."
read

git push -u origin main

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ SUCCESS! Repository pushed to GitHub"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "📊 GitHub Repository:"
echo "   https://github.com/moborarl/Fund-tracking"
echo ""
echo "🌐 Next: Connect to Cloudflare Pages"
echo "   1. Go to: https://dash.cloudflare.com/"
echo "   2. Pages → Create a project"
echo "   3. Connect to Git → Select moborarl/Fund-tracking"
echo "   4. Build settings:"
echo "      - Build command: (leave empty)"
echo "      - Output directory: . (dot)"
echo "   5. Deploy!"
echo ""
echo "📖 For details, read: DEPLOYMENT_CHECKLIST.md"
echo ""
