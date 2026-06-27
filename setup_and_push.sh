#!/bin/bash

echo "🚀 Setting up Fund Tracking Dashboard for GitHub + Cloudflare"
echo "============================================================="

# Initialize git repo
echo ""
echo "📦 Initializing Git repository..."
git init

# Configure git user (use provided email)
git config user.email "nuparkjr@gmail.com"
git config user.name "Nupark Jiravinyu"

# Add all files
echo "📂 Adding files..."
git add .

# Create initial commit
echo "💾 Creating initial commit..."
git commit -m "Initial commit: Fund value tracking dashboard

- Multi-AMC portfolio monitor
- Dark-themed responsive dashboard
- Chart.js visualizations
- 65 mutual funds tracking
- Professional financial UI
- Cloudflare Pages ready
- Documentation included"

# Add remote
echo "🔗 Adding GitHub remote..."
git remote add origin https://github.com/moborarl/Fund-tracking.git

# Push to GitHub
echo "📤 Pushing to GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "✅ Setup complete!"
echo "============================================================="
echo ""
echo "📊 Dashboard deployed to:"
echo "   GitHub: https://github.com/moborarl/Fund-tracking"
echo ""
echo "🌐 Next steps for Cloudflare Pages:"
echo "   1. Go to https://dash.cloudflare.com/"
echo "   2. Pages → Create project"
echo "   3. Select: moborarl/Fund-tracking"
echo "   4. Build settings: No build command needed"
echo "   5. Deploy!"
echo ""
echo "📖 Read: CLOUDFLARE_DEPLOYMENT.md for details"
