# Cloudflare Pages & Workers Deployment Guide

## Overview
This dashboard is optimized for deployment on **Cloudflare Pages** (static hosting) with optional **Cloudflare Workers** (for API integration and NAV updates).

---

## 📋 Prerequisite Setup

### 1. GitHub Repository
```bash
# Already configured:
Repository: https://github.com/moborarl/Fund-tracking.git
Branch: main (auto-deploys to Pages)
```

### 2. Cloudflare Account
- Sign up: https://dash.cloudflare.com/
- Add domain or use `*.pages.dev` subdomain

### 3. Install Tools
```bash
# Install Wrangler CLI (for local development)
npm install -g wrangler

# Or use npm locally
npm install wrangler --save-dev
```

---

## 🚀 Deployment Options

### Option A: Cloudflare Pages (Recommended - Static Only)

**Step 1: Connect GitHub**
1. Go to Cloudflare Dashboard → Pages
2. Click "Create a project"
3. Select "Connect to Git"
4. Authorize GitHub account
5. Select: `moborarl/Fund-tracking`
6. Click "Create project"

**Step 2: Configure Build**
- **Build command**: (leave empty - no build needed)
- **Build output directory**: `.` (root directory)
- **Root directory**: `.`
- **Node version**: 18+

**Step 3: Environment Variables** (if using NAV API)
In Cloudflare Pages Settings → Environment:
```
API_ENDPOINT=https://api.finnomena.com
NAV_REFRESH_INTERVAL=3600
```

**Step 4: Deploy**
- Push to GitHub main branch
- Cloudflare auto-deploys in ~1 minute
- Visit: `fund-tracking.pages.dev` (or custom domain)

---

### Option B: Cloudflare Workers (With NAV API)

For dynamic NAV price fetching, use Workers to proxy Finnomena API:

**Step 1: Create Worker**
```bash
wrangler login
wrangler publish
```

**Step 2: Worker Code** (optional `src/index.js`)
```javascript
export default {
  async fetch(request) {
    // Proxy NAV API requests
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const apiUrl = 'https://api.finnomena.com' + url.pathname;
      return fetch(apiUrl, {
        headers: { 'Authorization': 'Bearer YOUR_API_KEY' }
      });
    }
    // Serve static dashboard
    return new Response(await fetch('/KKP_Portfolio_Dashboard.html'));
  }
};
```

**Step 3: Deploy Worker**
```bash
wrangler publish
```

**Step 4: Route through Pages**
- Cloudflare Dashboard → Workers → Routes
- Add route: `fund-tracking.pages.dev/api/*`
- Route to Worker: `fund-tracking-worker`

---

## 📊 Current Setup (For Your Use)

### Simple Static Deployment ✓
```
GitHub (moborarl/Fund-tracking) 
    ↓
Cloudflare Pages (auto-build)
    ↓
fund-tracking.pages.dev (live)
    ↓
Browser loads: KKP_Portfolio_Dashboard.html
```

**All files served statically:**
- `KKP_Portfolio_Dashboard.html` (main app)
- `SAMPLE_DATA.json` (data reference)
- Documentation files (README, etc.)

---

## 🔧 Local Development

### Run Locally
```bash
# Option 1: Simple HTTP server
python -m http.server 8000
# Visit: http://localhost:8000

# Option 2: Using Wrangler (Preview Pages)
wrangler pages dev .
# Visit: http://localhost:8788
```

### Test Before Commit
```bash
# Run in browser
open http://localhost:8000/KKP_Portfolio_Dashboard.html

# Verify:
✓ Charts render
✓ Data loads
✓ Filters work
✓ Modal opens
✓ Responsive on mobile
```

---

## 📱 Custom Domain Setup

### Add Custom Domain to Pages

**Step 1: Domain DNS**
In your domain registrar (GoDaddy, Namecheap, etc.):
- Add CNAME: `fund-tracking.pages.dev`
- Or use Cloudflare nameservers

**Step 2: Pages Settings**
- Cloudflare Dashboard → Pages → Project Settings
- Click "Custom domains"
- Add: `portfolio.yourdomain.com` (or similar)

**Step 3: Verify & Wait**
- Cloudflare validates DNS
- Live in ~5 minutes

---

## 🔐 Environment Variables

### For API Integration (Future)

**Cloudflare Pages Settings → Environment:**
```
API_ENDPOINT = https://api.finnomena.com
API_KEY = your_finnomena_api_key
NAV_REFRESH_INTERVAL = 3600
TIMEZONE = Asia/Bangkok
```

**Access in JavaScript:**
```javascript
// In dashboard
const apiEndpoint = ENV.API_ENDPOINT;  // Set by Cloudflare
const refreshInterval = ENV.NAV_REFRESH_INTERVAL;
```

---

## 📈 Monitoring & Analytics

### Cloudflare Analytics
- Dashboard → Pages → Project → Analytics
- View: Page views, requests, performance
- Monitor: Errors, slow pages, traffic trends

### Enable WebAnalytics
In Cloudflare Pages Settings:
```
Web Analytics: Enabled
Reports: Daily emails
```

---

## 🚨 Troubleshooting

### Page Won't Deploy
**Issue**: Build fails or page blank
**Solution**:
```bash
# Check Pages build logs
cloudflare.com → Pages → Build History
# Most common: wrong build directory
# Fix: Set to "." (root)
```

### Dashboard Doesn't Load
**Issue**: HTML loads but charts broken
**Solution**:
```bash
# Check browser console (F12)
# Verify Chart.js loaded from CDN
# Check file paths in HTML
```

### CORS Issues with API
**Issue**: NAV API calls blocked
**Solution**:
```bash
# Use Cloudflare Workers to proxy
# Add to wrangler.toml:
[[routes]]
pattern = "example.com/api/*"
zone_name = "example.com"
```

---

## 📝 File Structure for Deployment

```
Fund-tracking/
├── KKP_Portfolio_Dashboard.html  ✓ Main app (served by Pages)
├── wrangler.toml                 ✓ Cloudflare config
├── README.md                      ✓ Project docs
├── PROJECT_BRIEF.md              ✓ Context
├── SAMPLE_DATA.json              ✓ Reference data
├── .gitignore                     ✓ Git config
└── CLOUDFLARE_DEPLOYMENT.md      ← (this file)
```

---

## ✅ Deployment Checklist

- [ ] GitHub repo created & connected
- [ ] Files committed: `git push origin main`
- [ ] Cloudflare Pages project created
- [ ] Build settings configured (no build command)
- [ ] Environment variables added (if using API)
- [ ] Custom domain connected (optional)
- [ ] Web Analytics enabled (optional)
- [ ] Test dashboard live on `pages.dev` URL
- [ ] Verify responsive design on mobile
- [ ] Check console for errors (F12)

---

## 🔄 Continuous Deployment

### Auto-Deploy Flow
```
1. Edit KKP_Portfolio_Dashboard.html locally
2. Commit: git commit -am "Update portfolio data"
3. Push: git push origin main
4. Cloudflare Pages auto-detects changes
5. Dashboard updates live in ~1 minute
6. No manual build or deploy needed ✓
```

---

## 📞 Need Help?

**Cloudflare Docs:**
- Pages: https://developers.cloudflare.com/pages/
- Workers: https://developers.cloudflare.com/workers/
- KV Storage: https://developers.cloudflare.com/kv/

**Common Tasks:**
- [Set custom domain](https://developers.cloudflare.com/pages/platform/custom-domains/)
- [Add environment vars](https://developers.cloudflare.com/pages/platform/build-configuration/)
- [Enable Workers](https://developers.cloudflare.com/pages/platform/functions/)

---

**Setup Date**: 2026-06-23  
**Last Updated**: 2026-06-23  
**Status**: Ready for Pages deployment ✅
