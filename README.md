# Sol Tracker

Complete Solana trade tracker with wallet analysis and manual trade logging.

## Features

### 🔍 Wallet Analyzer (Helius)
- Auto-fetch all swap transactions from any wallet
- Analyze realized/unrealized P&L per token
- Track max price after buy (what you could've sold at)
- Track max price after sell (missed gains)
- Detect roundtrips (pumped then dumped while holding)

### 📝 Manual Trade Tracker (DexScreener)
- Search any Solana token
- Log buy/sell trades manually
- Track open positions with live prices
- Analyze min/max prices during holding period
- Calculate % of max gain captured

## Setup

### 1. Get Helius API Key (Free)
1. Go to [helius.dev](https://helius.dev)
2. Sign up for free
3. Copy your API key

### 2. Deploy to Vercel

```bash
# Clone and deploy
git clone https://github.com/YOUR_USERNAME/sol-tracker.git
cd sol-tracker
npm install
npm run dev
```

Or deploy with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/sol-tracker)

### 3. Use the App
1. Go to Settings tab
2. Enter your Helius API key
3. Start analyzing wallets or logging trades!

## APIs Used

| API | Purpose | Rate Limit |
|-----|---------|------------|
| [Helius](https://helius.dev) | Wallet transactions | Varies |
| [DexScreener](https://dexscreener.com) | Token search & prices | 300/min |
| [GeckoTerminal](https://geckoterminal.com) | OHLCV history | 30/min |

## Data Storage

All data stored locally in your browser:
- API key
- Manual trades
- No server, 100% client-side

## Tech Stack

- Next.js 14
- Tailwind CSS
- LocalStorage

## License

MIT
