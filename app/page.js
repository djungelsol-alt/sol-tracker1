'use client';

import React, { useState, useEffect } from 'react';

// ============================================================================
// CONSTANTS
// ============================================================================

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const STABLES = [USDC_MINT, USDT_MINT];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const formatNumber = (num, decimals = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '-';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(decimals)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(decimals)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(decimals)}K`;
  return `$${num.toFixed(decimals)}`;
};

const formatPrice = (price) => {
  if (!price || isNaN(price)) return '-';
  if (price < 0.00000001) return `$${price.toExponential(2)}`;
  if (price < 0.0001) return `$${price.toFixed(10)}`;
  if (price < 0.01) return `$${price.toFixed(8)}`;
  if (price < 1) return `$${price.toFixed(6)}`;
  if (price < 100) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
};

const formatPercent = (pct) => {
  if (pct === null || pct === undefined || isNaN(pct)) return '-';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
};

const shortenAddress = (addr) => addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : '';

const timeAgo = (timestamp) => {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

// ============================================================================
// API SERVICES
// ============================================================================

const DexScreenerAPI = {
  async searchToken(query) {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      return data.pairs || [];
    } catch (error) {
      console.error('DexScreener search error:', error);
      return [];
    }
  },

  async getTokenPairs(chainId, tokenAddress) {
    try {
      const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/${chainId}/${tokenAddress}`);
      return await response.json() || [];
    } catch (error) {
      console.error('DexScreener token pairs error:', error);
      return [];
    }
  },

  async getTokenPrice(tokenAddress) {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      const data = await response.json();
      if (data.pairs?.length > 0) {
        const solanaPairs = data.pairs.filter(p => p.chainId === 'solana');
        if (solanaPairs.length > 0) {
          return {
            price: parseFloat(solanaPairs[0].priceUsd),
            symbol: solanaPairs[0].baseToken.symbol,
            name: solanaPairs[0].baseToken.name,
            marketCap: solanaPairs[0].marketCap,
            priceChange24h: solanaPairs[0].priceChange?.h24,
            pairAddress: solanaPairs[0].pairAddress
          };
        }
      }
      return null;
    } catch (error) {
      console.error('DexScreener error:', error);
      return null;
    }
  }
};

const GeckoTerminalAPI = {
  async getOHLCV(poolAddress, limit = 168) {
    try {
      const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/hour?aggregate=1&limit=${limit}`);
      const data = await response.json();
      return data.data?.attributes?.ohlcv_list || [];
    } catch (error) {
      console.error('GeckoTerminal OHLCV error:', error);
      return [];
    }
  }
};

const HeliusAPI = {
  async getSwapTransactions(walletAddress, apiKey, limit = 100) {
    try {
      const url = `https://api-mainnet.helius-rpc.com/v0/addresses/${walletAddress}/transactions?api-key=${apiKey}&type=SWAP&limit=${limit}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Helius API error: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Helius API error:', error);
      throw error;
    }
  }
};

// ============================================================================
// MANUAL TRADE ANALYSIS
// ============================================================================

const analyzeManualTrade = async (trade) => {
  const { poolAddress, buyTimestamp, sellTimestamp, buyPrice } = trade;
  const ohlcvData = await GeckoTerminalAPI.getOHLCV(poolAddress, 1000);
  if (!ohlcvData.length) return { ...trade, analysis: null };

  const buyTime = new Date(buyTimestamp).getTime();
  const sellTime = sellTimestamp ? new Date(sellTimestamp).getTime() : Date.now();
  
  const relevantCandles = ohlcvData.filter(candle => {
    const candleTime = candle[0] * 1000;
    return candleTime >= buyTime && candleTime <= sellTime;
  });

  if (!relevantCandles.length) return { ...trade, analysis: null };

  let minPrice = Infinity, maxPrice = -Infinity;
  relevantCandles.forEach(candle => {
    const [ts, open, high, low, close] = candle;
    if (low < minPrice) minPrice = low;
    if (high > maxPrice) maxPrice = high;
  });

  const pnlPercent = trade.sellPrice ? ((trade.sellPrice - buyPrice) / buyPrice) * 100 : null;
  const maxGainPercent = ((maxPrice - buyPrice) / buyPrice) * 100;
  const maxDrawdownPercent = ((minPrice - buyPrice) / buyPrice) * 100;
  const capturedPercent = pnlPercent !== null && maxGainPercent > 0 ? (pnlPercent / maxGainPercent) * 100 : null;

  return {
    ...trade,
    analysis: { minPrice, maxPrice, pnlPercent, maxGainPercent, maxDrawdownPercent, capturedPercent, candleCount: relevantCandles.length }
  };
};

// ============================================================================
// WALLET ANALYZER PROCESSING
// ============================================================================

const processSwapTransaction = (tx, walletAddress) => {
  if (!tx.events?.swap) return null;
  
  const swap = tx.events.swap;
  let tokenIn = null, tokenOut = null, amountIn = 0, amountOut = 0;
  
  if (swap.nativeInput) { tokenIn = { mint: SOL_MINT, symbol: 'SOL', decimals: 9 }; amountIn = swap.nativeInput.amount / 1e9; }
  if (swap.nativeOutput) { tokenOut = { mint: SOL_MINT, symbol: 'SOL', decimals: 9 }; amountOut = swap.nativeOutput.amount / 1e9; }
  
  if (swap.tokenInputs?.length > 0) {
    const input = swap.tokenInputs[0];
    tokenIn = { mint: input.mint, decimals: input.rawTokenAmount?.decimals || 9 };
    amountIn = parseFloat(input.rawTokenAmount?.tokenAmount || 0) / Math.pow(10, tokenIn.decimals);
  }
  
  if (swap.tokenOutputs?.length > 0) {
    const output = swap.tokenOutputs[0];
    tokenOut = { mint: output.mint, decimals: output.rawTokenAmount?.decimals || 9 };
    amountOut = parseFloat(output.rawTokenAmount?.tokenAmount || 0) / Math.pow(10, tokenOut.decimals);
  }
  
  if (!tokenIn || !tokenOut) return null;
  
  const isStableIn = tokenIn.mint === SOL_MINT || STABLES.includes(tokenIn.mint);
  const isStableOut = tokenOut.mint === SOL_MINT || STABLES.includes(tokenOut.mint);
  
  let type, token, stableAmount, tokenAmount;
  
  if (isStableIn && !isStableOut) {
    type = 'BUY'; token = tokenOut; stableAmount = amountIn; tokenAmount = amountOut;
  } else if (!isStableIn && isStableOut) {
    type = 'SELL'; token = tokenIn; stableAmount = amountOut; tokenAmount = amountIn;
  } else {
    return null;
  }
  
  const pricePerToken = tokenAmount > 0 ? stableAmount / tokenAmount : 0;
  
  return {
    signature: tx.signature,
    timestamp: tx.timestamp,
    type,
    tokenMint: token.mint,
    tokenAmount,
    stableAmount,
    pricePerToken,
    stableMint: isStableIn ? tokenIn.mint : tokenOut.mint
  };
};

const groupTradesByToken = (trades) => {
  const grouped = {};
  trades.forEach(trade => {
    if (!grouped[trade.tokenMint]) {
      grouped[trade.tokenMint] = { mint: trade.tokenMint, buys: [], sells: [], symbol: null, name: null, currentPrice: null, pairAddress: null };
    }
    if (trade.type === 'BUY') grouped[trade.tokenMint].buys.push(trade);
    else grouped[trade.tokenMint].sells.push(trade);
  });
  return grouped;
};

const analyzeWalletToken = async (tokenData) => {
  const priceInfo = await DexScreenerAPI.getTokenPrice(tokenData.mint);
  
  if (priceInfo) {
    tokenData.symbol = priceInfo.symbol;
    tokenData.name = priceInfo.name;
    tokenData.currentPrice = priceInfo.price;
    tokenData.marketCap = priceInfo.marketCap;
    tokenData.pairAddress = priceInfo.pairAddress;
    tokenData.priceChange24h = priceInfo.priceChange24h;
  }
  
  const totalBuyAmount = tokenData.buys.reduce((sum, b) => sum + b.stableAmount, 0);
  const totalBuyTokens = tokenData.buys.reduce((sum, b) => sum + b.tokenAmount, 0);
  const avgBuyPrice = totalBuyTokens > 0 ? totalBuyAmount / totalBuyTokens : 0;
  
  const totalSellAmount = tokenData.sells.reduce((sum, s) => sum + s.stableAmount, 0);
  const totalSellTokens = tokenData.sells.reduce((sum, s) => sum + s.tokenAmount, 0);
  const avgSellPrice = totalSellTokens > 0 ? totalSellAmount / totalSellTokens : 0;
  
  const realizedPnL = totalSellAmount - (totalSellTokens * avgBuyPrice);
  const realizedPnLPercent = totalSellTokens > 0 && avgBuyPrice > 0 ? ((avgSellPrice - avgBuyPrice) / avgBuyPrice) * 100 : 0;
  
  const tokensHeld = totalBuyTokens - totalSellTokens;
  const unrealizedValue = tokensHeld * (tokenData.currentPrice || 0);
  const costBasis = tokensHeld * avgBuyPrice;
  const unrealizedPnL = unrealizedValue - costBasis;
  const unrealizedPnLPercent = costBasis > 0 ? ((unrealizedValue - costBasis) / costBasis) * 100 : 0;
  
  let maxPriceAfterBuy = tokenData.currentPrice || 0;
  let minPriceAfterBuy = tokenData.currentPrice || Infinity;
  let maxPriceAfterSell = tokenData.currentPrice || 0;
  
  if (tokenData.pairAddress) {
    const ohlcv = await GeckoTerminalAPI.getOHLCV(tokenData.pairAddress);
    if (ohlcv.length > 0) {
      const firstBuyTime = tokenData.buys.length > 0 ? Math.min(...tokenData.buys.map(b => b.timestamp)) : 0;
      const lastSellTime = tokenData.sells.length > 0 ? Math.max(...tokenData.sells.map(s => s.timestamp)) : 0;
      
      ohlcv.forEach(candle => {
        const [ts, open, high, low, close] = candle;
        if (ts > firstBuyTime) {
          if (high > maxPriceAfterBuy) maxPriceAfterBuy = high;
          if (low < minPriceAfterBuy) minPriceAfterBuy = low;
        }
        if (lastSellTime > 0 && ts > lastSellTime) {
          if (high > maxPriceAfterSell) maxPriceAfterSell = high;
        }
      });
    }
  }
  
  const maxGainPossible = avgBuyPrice > 0 ? ((maxPriceAfterBuy - avgBuyPrice) / avgBuyPrice) * 100 : 0;
  const maxDrawdown = avgBuyPrice > 0 ? ((minPriceAfterBuy - avgBuyPrice) / avgBuyPrice) * 100 : 0;
  
  let missedGains = 0, missedGainsPercent = 0;
  if (tokenData.sells.length > 0 && avgSellPrice > 0) {
    missedGains = (maxPriceAfterSell - avgSellPrice) * totalSellTokens;
    missedGainsPercent = ((maxPriceAfterSell - avgSellPrice) / avgSellPrice) * 100;
  }
  
  const isRoundtrip = tokensHeld > 0 && maxPriceAfterBuy > avgBuyPrice * 1.5 && tokenData.currentPrice < avgBuyPrice;
  
  return {
    ...tokenData, totalBuyAmount, totalBuyTokens, avgBuyPrice, totalSellAmount, totalSellTokens, avgSellPrice,
    realizedPnL, realizedPnLPercent, tokensHeld, unrealizedValue, unrealizedPnL, unrealizedPnLPercent,
    maxPriceAfterBuy, minPriceAfterBuy: minPriceAfterBuy === Infinity ? 0 : minPriceAfterBuy, maxPriceAfterSell,
    maxGainPossible, maxDrawdown, missedGains, missedGainsPercent, isRoundtrip,
    status: tokensHeld > 0.001 ? 'HOLDING' : 'CLOSED'
  };
};

// ============================================================================
// MANUAL TRACKER COMPONENTS
// ============================================================================

const TokenSearch = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    const pairs = await DexScreenerAPI.searchToken(query);
    setResults(pairs.filter(p => p.chainId === 'solana').slice(0, 10));
    setLoading(false);
  };

  return (
    <div className="mb-5">
      <div className="flex gap-2">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSearch()} placeholder="Search token name or paste address..." className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50" />
        <button onClick={handleSearch} disabled={loading} className="px-6 py-3 bg-gradient-to-r from-emerald-400 to-cyan-400 text-black font-semibold rounded-lg hover:shadow-lg hover:shadow-emerald-500/30 transition-all disabled:opacity-50">{loading ? '...' : 'Search'}</button>
      </div>
      {results.length > 0 && (
        <div className="mt-2 bg-white/5 border border-white/10 rounded-lg overflow-hidden">
          {results.map((pair, idx) => (
            <div key={idx} className="px-4 py-3 border-b border-white/5 last:border-b-0 cursor-pointer hover:bg-emerald-500/10 flex justify-between items-center" onClick={() => { onSelect(pair); setResults([]); setQuery(''); }}>
              <div><span className="font-semibold text-white">{pair.baseToken.symbol}</span><span className="text-xs text-gray-500 ml-2">{pair.baseToken.name}</span></div>
              <div className="flex gap-4 mono text-xs"><span className="text-emerald-400">{formatPrice(parseFloat(pair.priceUsd))}</span><span className="text-gray-500">{formatNumber(pair.marketCap)}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const TradeInputForm = ({ selectedToken, onAddTrade }) => {
  const [formData, setFormData] = useState({ buyPrice: '', buyAmount: '', buyMarketCap: '', buyTimestamp: new Date().toISOString().slice(0, 16), sellPrice: '', sellTimestamp: '', notes: '' });
  
  useEffect(() => { if (selectedToken) setFormData(prev => ({ ...prev, buyPrice: selectedToken.priceUsd || '', buyMarketCap: selectedToken.marketCap || '' })); }, [selectedToken]);
  
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedToken) return;
    const trade = {
      id: Date.now(), tokenAddress: selectedToken.baseToken.address, tokenSymbol: selectedToken.baseToken.symbol, tokenName: selectedToken.baseToken.name,
      poolAddress: selectedToken.pairAddress, dexId: selectedToken.dexId, chainId: selectedToken.chainId,
      buyPrice: parseFloat(formData.buyPrice), buyAmount: parseFloat(formData.buyAmount), buyMarketCap: parseFloat(formData.buyMarketCap),
      buyTimestamp: formData.buyTimestamp, sellPrice: formData.sellPrice ? parseFloat(formData.sellPrice) : null,
      sellTimestamp: formData.sellTimestamp || null, notes: formData.notes, status: formData.sellPrice ? 'closed' : 'open', createdAt: new Date().toISOString()
    };
    onAddTrade(trade);
    setFormData({ buyPrice: '', buyAmount: '', buyMarketCap: '', buyTimestamp: new Date().toISOString().slice(0, 16), sellPrice: '', sellTimestamp: '', notes: '' });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-xl p-6">
      <div className="flex justify-between items-center mb-5">
        <h3 className="text-lg font-semibold text-white">Log Trade</h3>
        {selectedToken && <div className="flex gap-2 items-center px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-full"><span className="font-semibold text-emerald-400">{selectedToken.baseToken.symbol}</span></div>}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="text-xs text-gray-500 block mb-1">Buy Price (USD)</label><input type="number" step="any" value={formData.buyPrice} onChange={(e) => setFormData({ ...formData, buyPrice: e.target.value })} required className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50" /></div>
        <div><label className="text-xs text-gray-500 block mb-1">Amount (USD)</label><input type="number" step="any" value={formData.buyAmount} onChange={(e) => setFormData({ ...formData, buyAmount: e.target.value })} required className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50" /></div>
        <div><label className="text-xs text-gray-500 block mb-1">Market Cap at Buy</label><input type="number" step="any" value={formData.buyMarketCap} onChange={(e) => setFormData({ ...formData, buyMarketCap: e.target.value })} className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50" /></div>
        <div><label className="text-xs text-gray-500 block mb-1">Buy Time</label><input type="datetime-local" value={formData.buyTimestamp} onChange={(e) => setFormData({ ...formData, buyTimestamp: e.target.value })} required className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="text-xs text-gray-500 block mb-1">Sell Price (Optional)</label><input type="number" step="any" value={formData.sellPrice} onChange={(e) => setFormData({ ...formData, sellPrice: e.target.value })} className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50" /></div>
        <div><label className="text-xs text-gray-500 block mb-1">Sell Time</label><input type="datetime-local" value={formData.sellTimestamp} onChange={(e) => setFormData({ ...formData, sellTimestamp: e.target.value })} className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50" /></div>
      </div>
      <div className="mb-4"><label className="text-xs text-gray-500 block mb-1">Notes</label><textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Trade notes..." className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50 min-h-[60px] resize-y" /></div>
      <button type="submit" disabled={!selectedToken} className="w-full py-3 bg-gradient-to-r from-emerald-400 to-cyan-400 text-black font-semibold rounded-lg hover:shadow-lg transition-all disabled:opacity-50">{selectedToken ? 'Add Trade' : 'Select a token first'}</button>
    </form>
  );
};

const ManualTradeCard = ({ trade, onUpdate, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [currentPrice, setCurrentPrice] = useState(null);

  useEffect(() => {
    if (trade.status === 'open') {
      const fetchPrice = async () => {
        const pairs = await DexScreenerAPI.getTokenPairs('solana', trade.tokenAddress);
        if (pairs.length > 0) setCurrentPrice(parseFloat(pairs[0].priceUsd));
      };
      fetchPrice();
      const interval = setInterval(fetchPrice, 30000);
      return () => clearInterval(interval);
    }
  }, [trade]);

  const handleAnalyze = async () => { setAnalyzing(true); const analyzed = await analyzeManualTrade(trade); onUpdate(analyzed); setAnalyzing(false); };
  const pnl = trade.sellPrice ? ((trade.sellPrice - trade.buyPrice) / trade.buyPrice) * 100 : currentPrice ? ((currentPrice - trade.buyPrice) / trade.buyPrice) * 100 : null;

  return (
    <div className={`bg-white/5 border border-white/10 rounded-xl overflow-hidden ${trade.status === 'open' ? 'border-l-2 border-l-emerald-400' : 'border-l-2 border-l-gray-600'}`}>
      <div className="px-5 py-4 flex justify-between items-center cursor-pointer hover:bg-white/5" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-white">{trade.tokenSymbol}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${trade.status === 'open' ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-500 bg-white/5'}`}>{trade.status === 'open' ? '🟢 Open' : '⚫ Closed'}</span>
        </div>
        <div className="flex items-center gap-4">
          {pnl !== null && <span className={`mono text-lg font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-pink-500'}`}>{formatPercent(pnl)}</span>}
          <span className="text-gray-600">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-5 pb-5 border-t border-white/5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
            <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Buy Price</span><span className="mono text-sm text-white">{formatPrice(trade.buyPrice)}</span></div>
            <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Amount</span><span className="mono text-sm text-white">{formatNumber(trade.buyAmount)}</span></div>
            <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Buy MCap</span><span className="mono text-sm text-white">{formatNumber(trade.buyMarketCap)}</span></div>
            {trade.sellPrice && <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Sell Price</span><span className="mono text-sm text-white">{formatPrice(trade.sellPrice)}</span></div>}
            {trade.status === 'open' && currentPrice && <div className="bg-emerald-500/10 p-2 rounded-lg"><span className="text-[10px] text-gray-600 uppercase block mb-1">Current</span><span className="mono text-sm text-white">{formatPrice(currentPrice)}</span></div>}
          </div>
          {trade.analysis && (
            <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-4 my-4">
              <h4 className="text-sm text-cyan-400 mb-3">📊 Analysis</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center"><span className="text-[10px] text-gray-600 uppercase block">Max Price</span><span className="mono text-emerald-400">{formatPrice(trade.analysis.maxPrice)}</span><span className="text-xs text-gray-500 block">{formatPercent(trade.analysis.maxGainPercent)}</span></div>
                <div className="text-center"><span className="text-[10px] text-gray-600 uppercase block">Min Price</span><span className="mono text-pink-500">{formatPrice(trade.analysis.minPrice)}</span><span className="text-xs text-gray-500 block">{formatPercent(trade.analysis.maxDrawdownPercent)}</span></div>
                {trade.analysis.pnlPercent !== null && <div className="text-center"><span className="text-[10px] text-gray-600 uppercase block">Realized P&L</span><span className={`mono ${trade.analysis.pnlPercent >= 0 ? 'text-emerald-400' : 'text-pink-500'}`}>{formatPercent(trade.analysis.pnlPercent)}</span></div>}
                {trade.analysis.capturedPercent !== null && <div className="text-center"><span className="text-[10px] text-gray-600 uppercase block">% Captured</span><span className="mono text-white">{formatPercent(trade.analysis.capturedPercent)}</span></div>}
              </div>
            </div>
          )}
          {trade.notes && <div className="bg-white/5 rounded-lg p-3 my-4"><p className="text-sm text-gray-400">{trade.notes}</p></div>}
          <div className="flex gap-2 mt-4">
            <button onClick={handleAnalyze} disabled={analyzing} className="px-4 py-2 border border-white/10 rounded-lg text-gray-400 text-sm hover:bg-white/5 hover:text-cyan-400 transition-all disabled:opacity-50">{analyzing ? 'Analyzing...' : '📈 Analyze'}</button>
            <button onClick={() => onDelete(trade.id)} className="px-4 py-2 border border-white/10 rounded-lg text-gray-400 text-sm hover:bg-white/5 hover:text-pink-500 transition-all">🗑️ Delete</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// WALLET ANALYZER COMPONENTS
// ============================================================================

const WalletTokenCard = ({ token }) => {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className={`bg-white/5 border rounded-xl overflow-hidden ${token.isRoundtrip ? 'border-pink-500/50 border-l-2 border-l-pink-500' : token.status === 'HOLDING' ? 'border-emerald-500/30 border-l-2 border-l-emerald-400' : 'border-white/10 border-l-2 border-l-gray-600'}`}>
      <div className="px-5 py-4 flex justify-between items-center cursor-pointer hover:bg-white/5" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-white">{token.symbol || shortenAddress(token.mint)}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${token.isRoundtrip ? 'text-pink-400 bg-pink-500/10' : token.status === 'HOLDING' ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-500 bg-white/5'}`}>
            {token.isRoundtrip ? '🔄 Roundtrip' : token.status === 'HOLDING' ? '🟢 Holding' : '⚫ Closed'}
          </span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <span className={`mono text-lg font-semibold ${(token.realizedPnL + token.unrealizedPnL) >= 0 ? 'text-emerald-400' : 'text-pink-500'}`}>{formatNumber(token.realizedPnL + token.unrealizedPnL)}</span>
            <span className="text-xs text-gray-500 block">{formatPercent(token.status === 'HOLDING' ? token.unrealizedPnLPercent : token.realizedPnLPercent)}</span>
          </div>
          {token.missedGainsPercent > 10 && <div className="text-right"><span className="mono text-sm text-orange-400">+{formatPercent(token.missedGainsPercent)}</span><span className="text-[10px] text-gray-600 block">missed</span></div>}
          <span className="text-gray-600">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-5 pb-5 border-t border-white/5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
            <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Avg Buy</span><span className="mono text-sm text-white">{formatPrice(token.avgBuyPrice)}</span></div>
            <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Current</span><span className="mono text-sm text-white">{formatPrice(token.currentPrice)}</span></div>
            <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Max After Buy</span><span className="mono text-sm text-emerald-400">{formatPrice(token.maxPriceAfterBuy)}</span><span className="text-[10px] text-gray-500 ml-1">{formatPercent(token.maxGainPossible)}</span></div>
            <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Invested</span><span className="mono text-sm text-white">{formatNumber(token.totalBuyAmount)}</span></div>
          </div>
          {token.sells.length > 0 && (
            <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-4 my-4">
              <h4 className="text-sm text-cyan-400 mb-3">📊 Sell Analysis</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center"><span className="text-[10px] text-gray-600 uppercase block">Avg Sell</span><span className="mono text-white">{formatPrice(token.avgSellPrice)}</span></div>
                <div className="text-center"><span className="text-[10px] text-gray-600 uppercase block">Realized</span><span className={`mono ${token.realizedPnL >= 0 ? 'text-emerald-400' : 'text-pink-500'}`}>{formatNumber(token.realizedPnL)}</span></div>
                <div className="text-center"><span className="text-[10px] text-gray-600 uppercase block">Max After Sell</span><span className="mono text-orange-400">{formatPrice(token.maxPriceAfterSell)}</span></div>
                <div className="text-center"><span className="text-[10px] text-gray-600 uppercase block">Missed</span><span className="mono text-orange-400">{token.missedGainsPercent > 0 ? `+${formatPercent(token.missedGainsPercent)}` : '-'}</span></div>
              </div>
            </div>
          )}
          {token.isRoundtrip && (
            <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg p-4 my-4">
              <h4 className="text-sm text-pink-400 mb-2">🔄 Roundtrip Alert</h4>
              <p className="text-sm text-gray-400">Went up <span className="text-emerald-400 font-semibold">{formatPercent(token.maxGainPossible)}</span> but now <span className="text-pink-400 font-semibold">{formatPercent(token.unrealizedPnLPercent)}</span></p>
            </div>
          )}
          <div className="mt-4 max-h-32 overflow-y-auto space-y-1">
            {[...token.buys, ...token.sells].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5).map((trade, i) => (
              <div key={i} className="flex justify-between text-sm px-3 py-2 bg-black/30 rounded-lg">
                <span className={trade.type === 'BUY' ? 'text-emerald-400' : 'text-pink-400'}>{trade.type === 'BUY' ? '🟢' : '🔴'} {trade.type}</span>
                <span className="mono text-gray-400">{formatNumber(trade.stableAmount)} @ {formatPrice(trade.pricePerToken)}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <a href={`https://dexscreener.com/solana/${token.mint}`} target="_blank" rel="noopener noreferrer" className="px-4 py-2 border border-white/10 rounded-lg text-gray-400 text-sm hover:bg-white/5 hover:text-cyan-400 transition-all">📈 DexScreener</a>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN APP
// ============================================================================

export default function SolTracker() {
  const [activeTab, setActiveTab] = useState('analyzer');
  
  // Manual Tracker State
  const [manualTrades, setManualTrades] = useState([]);
  const [selectedToken, setSelectedToken] = useState(null);
  
  // Wallet Analyzer State
  const [apiKey, setApiKey] = useState('');
  const [wallet, setWallet] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [walletTokens, setWalletTokens] = useState([]);
  const [sortBy, setSortBy] = useState('pnl');

  // Load saved data
  useEffect(() => {
    const savedKey = localStorage.getItem('helius-api-key');
    if (savedKey) setApiKey(savedKey);
    const savedTrades = localStorage.getItem('sol-tracker-trades');
    if (savedTrades) try { setManualTrades(JSON.parse(savedTrades)); } catch (e) {}
  }, []);

  // Save data
  useEffect(() => { if (apiKey) localStorage.setItem('helius-api-key', apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem('sol-tracker-trades', JSON.stringify(manualTrades)); }, [manualTrades]);

  // Manual trade handlers
  const handleAddTrade = (trade) => { setManualTrades(prev => [trade, ...prev]); setSelectedToken(null); };
  const handleUpdateTrade = (updated) => { setManualTrades(prev => prev.map(t => t.id === updated.id ? updated : t)); };
  const handleDeleteTrade = (id) => { if (window.confirm('Delete?')) setManualTrades(prev => prev.filter(t => t.id !== id)); };

  // Wallet analyzer
  const analyzeWallet = async () => {
    if (!apiKey || !wallet) return;
    setLoading(true); setError(null); setWalletTokens([]); setProgress('Fetching transactions...');
    
    try {
      const transactions = await HeliusAPI.getSwapTransactions(wallet, apiKey, 100);
      setProgress(`Found ${transactions.length} swaps. Processing...`);
      
      const trades = transactions.map(tx => processSwapTransaction(tx, wallet)).filter(Boolean);
      const grouped = groupTradesByToken(trades);
      const tokenList = Object.values(grouped);
      setProgress(`Found ${tokenList.length} tokens. Fetching prices...`);
      
      const analyzed = [];
      for (let i = 0; i < tokenList.length; i++) {
        setProgress(`Analyzing ${i + 1}/${tokenList.length}...`);
        analyzed.push(await analyzeWalletToken(tokenList[i]));
        await new Promise(r => setTimeout(r, 200));
      }
      
      setWalletTokens(analyzed);
      setProgress('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const sortedTokens = [...walletTokens].sort((a, b) => {
    if (sortBy === 'pnl') return (b.realizedPnL + b.unrealizedPnL) - (a.realizedPnL + a.unrealizedPnL);
    if (sortBy === 'missed') return b.missedGainsPercent - a.missedGainsPercent;
    if (sortBy === 'invested') return b.totalBuyAmount - a.totalBuyAmount;
    return 0;
  });

  // Stats
  const walletStats = walletTokens.length > 0 ? {
    total: walletTokens.length,
    invested: walletTokens.reduce((s, t) => s + t.totalBuyAmount, 0),
    realized: walletTokens.reduce((s, t) => s + t.realizedPnL, 0),
    unrealized: walletTokens.reduce((s, t) => s + t.unrealizedPnL, 0),
    missed: walletTokens.reduce((s, t) => s + Math.max(0, t.missedGains), 0),
    roundtrips: walletTokens.filter(t => t.isRoundtrip).length
  } : null;

  const manualStats = manualTrades.length > 0 ? {
    total: manualTrades.length,
    open: manualTrades.filter(t => t.status === 'open').length,
    invested: manualTrades.reduce((s, t) => s + (t.buyAmount || 0), 0)
  } : null;

  return (
    <div className="min-h-screen p-5">
      <header className="text-center py-8 border-b border-white/5 mb-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-500 bg-clip-text text-transparent mb-2">Sol Tracker</h1>
        <p className="text-gray-500 mono text-sm">Wallet Analyzer & Trade Tracker</p>
      </header>

      {/* Tab Navigation */}
      <nav className="flex gap-2 justify-center mb-8 flex-wrap">
        {[
          { key: 'analyzer', label: '🔍 Wallet Analyzer', desc: 'Auto-fetch trades' },
          { key: 'manual', label: '📝 Manual Tracker', desc: 'Log trades manually' },
          { key: 'settings', label: '⚙️ Settings', desc: 'API key' }
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === tab.key ? 'bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 text-emerald-400' : 'bg-white/5 border border-white/10 text-gray-500 hover:text-white'}`}>
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="max-w-6xl mx-auto">
        {/* ============ WALLET ANALYZER TAB ============ */}
        {activeTab === 'analyzer' && (
          <>
            {!apiKey ? (
              <div className="p-6 bg-orange-500/10 border border-orange-500/30 rounded-xl text-center">
                <p className="text-orange-400 mb-2">🔑 Helius API Key Required</p>
                <p className="text-sm text-gray-400 mb-4">Go to Settings tab to add your API key</p>
                <button onClick={() => setActiveTab('settings')} className="px-6 py-2 bg-orange-500/20 border border-orange-500/30 rounded-lg text-orange-400 hover:bg-orange-500/30 transition-all">Go to Settings</button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-6">
                  <input type="text" value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Enter Solana wallet address..." className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50" />
                  <button onClick={analyzeWallet} disabled={loading || !wallet} className="px-8 py-3 bg-gradient-to-r from-emerald-400 to-cyan-400 text-black font-semibold rounded-lg hover:shadow-lg transition-all disabled:opacity-50">{loading ? '⏳ Analyzing...' : '🔍 Analyze'}</button>
                </div>

                {progress && <div className="mb-6 p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-xl"><p className="text-cyan-400 text-sm mono">{progress}</p></div>}
                {error && <div className="mb-6 p-4 bg-pink-500/10 border border-pink-500/30 rounded-xl"><p className="text-pink-400 text-sm">❌ {error}</p></div>}

                {walletStats && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"><span className="mono text-xl font-bold text-white block">{walletStats.total}</span><span className="text-[10px] text-gray-500 uppercase">Tokens</span></div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"><span className="mono text-xl font-bold text-white block">{formatNumber(walletStats.invested)}</span><span className="text-[10px] text-gray-500 uppercase">Invested</span></div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"><span className={`mono text-xl font-bold block ${walletStats.realized >= 0 ? 'text-emerald-400' : 'text-pink-500'}`}>{formatNumber(walletStats.realized)}</span><span className="text-[10px] text-gray-500 uppercase">Realized</span></div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"><span className={`mono text-xl font-bold block ${walletStats.unrealized >= 0 ? 'text-emerald-400' : 'text-pink-500'}`}>{formatNumber(walletStats.unrealized)}</span><span className="text-[10px] text-gray-500 uppercase">Unrealized</span></div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"><span className="mono text-xl font-bold text-orange-400 block">{formatNumber(walletStats.missed)}</span><span className="text-[10px] text-gray-500 uppercase">Missed</span></div>
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"><span className="mono text-xl font-bold text-pink-500 block">{walletStats.roundtrips}</span><span className="text-[10px] text-gray-500 uppercase">Roundtrips</span></div>
                  </div>
                )}

                {walletTokens.length > 0 && (
                  <>
                    <div className="flex gap-2 mb-4 flex-wrap">
                      <span className="text-gray-500 text-sm py-2">Sort:</span>
                      {[{ key: 'pnl', label: 'P&L' }, { key: 'missed', label: 'Missed' }, { key: 'invested', label: 'Invested' }].map(opt => (
                        <button key={opt.key} onClick={() => setSortBy(opt.key)} className={`px-4 py-2 rounded-lg text-sm transition-all ${sortBy === opt.key ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400' : 'bg-white/5 border border-white/10 text-gray-500'}`}>{opt.label}</button>
                      ))}
                    </div>
                    <div className="space-y-4">{sortedTokens.map(token => <WalletTokenCard key={token.mint} token={token} />)}</div>
                  </>
                )}

                {!loading && walletTokens.length === 0 && !error && (
                  <div className="text-center py-16 text-gray-500">
                    <div className="text-6xl mb-5">🔍</div>
                    <h3 className="text-lg text-gray-400 mb-2">Enter a wallet to analyze</h3>
                    <p className="text-sm">Auto-fetch swap history and see missed gains</p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ============ MANUAL TRACKER TAB ============ */}
        {activeTab === 'manual' && (
          <>
            {manualStats && (
              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"><span className="mono text-xl font-bold text-white block">{manualStats.total}</span><span className="text-[10px] text-gray-500 uppercase">Trades</span></div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"><span className="mono text-xl font-bold text-emerald-400 block">{manualStats.open}</span><span className="text-[10px] text-gray-500 uppercase">Open</span></div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"><span className="mono text-xl font-bold text-white block">{formatNumber(manualStats.invested)}</span><span className="text-[10px] text-gray-500 uppercase">Invested</span></div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-8 mb-8">
              <div>
                <TokenSearch onSelect={setSelectedToken} />
                <TradeInputForm selectedToken={selectedToken} onAddTrade={handleAddTrade} />
              </div>
              <div>
                {selectedToken && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <h3 className="font-semibold text-white mb-4">Selected Token</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Symbol</span><span className="text-lg font-semibold text-white">{selectedToken.baseToken.symbol}</span></div>
                      <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Price</span><span className="mono text-emerald-400">{formatPrice(parseFloat(selectedToken.priceUsd))}</span></div>
                      <div><span className="text-[10px] text-gray-600 uppercase block mb-1">Market Cap</span><span className="mono text-white">{formatNumber(selectedToken.marketCap)}</span></div>
                      <div><span className="text-[10px] text-gray-600 uppercase block mb-1">24h Change</span><span className={`mono ${selectedToken.priceChange?.h24 >= 0 ? 'text-emerald-400' : 'text-pink-500'}`}>{formatPercent(selectedToken.priceChange?.h24)}</span></div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {manualTrades.length > 0 ? (
              <div className="space-y-4">{manualTrades.map(trade => <ManualTradeCard key={trade.id} trade={trade} onUpdate={handleUpdateTrade} onDelete={handleDeleteTrade} />)}</div>
            ) : (
              <div className="text-center py-16 text-gray-500">
                <div className="text-6xl mb-5">📝</div>
                <h3 className="text-lg text-gray-400 mb-2">No trades logged</h3>
                <p className="text-sm">Search a token above to start logging trades</p>
              </div>
            )}
          </>
        )}

        {/* ============ SETTINGS TAB ============ */}
        {activeTab === 'settings' && (
          <div className="max-w-xl mx-auto">
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">🔑 Helius API Key</h3>
              <p className="text-sm text-gray-400 mb-4">Required for Wallet Analyzer. Get a free key at <a href="https://helius.dev" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">helius.dev</a></p>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Enter your Helius API key..." className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white mono text-sm outline-none focus:border-emerald-500/50 mb-4" />
              {apiKey && <p className="text-sm text-emerald-400">✓ API key saved to browser</p>}
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mt-6">
              <h3 className="text-lg font-semibold text-white mb-4">📊 APIs Used</h3>
              <div className="space-y-3">
                {[
                  { name: 'Helius', purpose: 'Wallet swap transactions', limit: 'Varies by plan' },
                  { name: 'DexScreener', purpose: 'Token prices & search', limit: '300/min' },
                  { name: 'GeckoTerminal', purpose: 'Price history (OHLCV)', limit: '30/min' }
                ].map((api, i) => (
                  <div key={i} className="bg-black/30 rounded-lg p-3">
                    <span className="text-emerald-400 font-medium">{api.name}</span>
                    <span className="text-gray-500 text-sm ml-2">- {api.purpose}</span>
                    <span className="text-gray-600 text-xs block mt-1">Rate limit: {api.limit}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mt-6">
              <h3 className="text-lg font-semibold text-white mb-4">💾 Data Storage</h3>
              <p className="text-sm text-gray-400 mb-4">All data is stored locally in your browser. Nothing is sent to any server.</p>
              <button onClick={() => { if (window.confirm('Clear all data?')) { localStorage.clear(); setManualTrades([]); setWalletTokens([]); setApiKey(''); }}} className="px-4 py-2 border border-pink-500/30 rounded-lg text-pink-400 text-sm hover:bg-pink-500/10 transition-all">Clear All Data</button>
            </div>
          </div>
        )}
      </main>

      <footer className="text-center py-8 mt-12 border-t border-white/5">
        <p className="text-gray-600 text-sm">Powered by Helius • DexScreener • GeckoTerminal</p>
      </footer>
    </div>
  );
}
