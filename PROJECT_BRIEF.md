# Fund Value Tracking Dashboard - Project Brief

## Project Overview
Building a professional, dark-themed HTML dashboard to track mutual fund portfolio performance across multiple fund management companies (AMCs) in Thailand.

## Target Audience
Portfolio managers and experienced investors who understand investment terminology and can read complex financial data.

## Deliverable
**Single HTML File** - Self-contained, responsive dashboard with:
- Dark theme design (sophisticated, professional)
- Real-time fund value tracking
- Portfolio allocation visualization
- Historical performance comparison
- Fund holdings table with sorting/filtering

## Key Features Required

### Hero Section
- Total portfolio value (฿ currency)
- Cost basis & unrealized P/L
- Time period filters (1D, 1W, 15D, 1M)
- Performance change indicators

### Allocation Charts
- By Asset Class (Thai Equity, Foreign Equity, Mixed, Fixed Income)
- By AMC (KKP, LH Fund, ONE, Bualuang, UOB, SCB, Eastspring, K-Fund)
- By Tax Benefit (SSF, ThaiESGX, ThaiESG, General)

### Data Table
- Fund name & code
- NAV (Net Asset Value)
- Units held
- Market value
- Weight in portfolio
- Change (%) over selected period
- Unrealized P/L
- Realized P/L

### Additional Features
- Historical chart with multi-fund comparison
- Top gainers/losers ranking
- P/L breakdown (realized vs unrealized)
- Fund detail modal with performance metrics
- Search & multi-select for analysis
- Portfolio filtering by AMC & tax status

## Data Structure

Each fund requires:
```
{
  "fund_code": {
    "name": "Full fund name",
    "amc": "Fund company",
    "tax": "Tax benefit type",
    "asset": "Asset class",
    "units": 1234.5678,           // Position size
    "avg": 10.50,                 // Average cost price
    "realized": 1500.00           // Cumulative realized P/L
  }
}
```

## Design Requirements
- **Theme**: Dark (sophisticated, polished)
- **Layout**: Well-structured sections with clear hierarchy
- **Navigation**: Smooth, intuitive
- **Typography**: Professional sans-serif (Inter/IBM Plex Sans Thai)
- **Color Palette**: 
  - Positive: Green (#1fd286)
  - Negative: Red (#ff5a6a)
  - Accent: Blue (#4d8dff)
  - Background: Very dark gray (#070b14)
  - Panels: Slightly lighter (#101829)

## Data Sources
- **NAV Data**: Finnomena API (live stock prices)
- **Fund Metadata**: Static holdings data
- **Cost Basis**: User portfolio statements
- **Realized P/L**: User transaction history

## Quality Standards
- Built by developers at a leading fund/financial firm
- Pixel-perfect dark theme implementation
- Smooth animations and transitions
- Accessible color contrasts
- Mobile-responsive design
- Chart visualization with Chart.js
- No external dependencies beyond charting library

## Project Status
✅ Core dashboard structure created  
✅ Data verification complete  
🔄 Integration with live NAV data  
📋 Allocation charts implemented  
📊 Performance tracking ready

---

**For use in:**
- Dashboard maintenance
- Feature additions
- Alternative implementations
- Team onboarding
