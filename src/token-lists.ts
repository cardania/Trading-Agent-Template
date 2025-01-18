import { Category } from './config/portfolio-settings';

// 'ada'
// 'meme_coins'
// 'AI'
// 'gaming'
// 'stable'
// 'defi'
// 'other';


export interface TokenConfig {
  unit: string;
  ticker: string;
  decimals?: number;
  category: Category;
  minTradeSize?: number;  // Minimum trade size in ADA
  maxTradeSize?: number;  // Maximum trade size in ADA
  profitTargets?: {
    quick: number;     // e.g., 0.05 for 5% profit target
    medium: number;    // e.g., 0.15 for 15% profit target
    long: number;      // e.g., 0.30 for 30% profit target
  };
  stopLoss?: number;   // e.g., -0.10 for 10% stop loss
  trailingStop?: number; // e.g., 0.05 for 5% trailing stop from peak
  maxHoldTime?: number; // Maximum hold time in hours
}

export const TRADING_TOKENS: TokenConfig[] = [
  // AI
  {
    unit: "97bbb7db0baef89caefce61b8107ac74c7a7340166b39d906f174bec54616c6f73",
    ticker: "TALOS",
    category: "ai",
    minTradeSize: 10,
    maxTradeSize: 200,
    profitTargets: {
      quick: 0.10,
      medium: 0.20,
      long: 0.30
    },
    trailingStop: 0.05
  },
  
  // Gaming
  {
    unit: "6787a47e9f73efe4002d763337140da27afa8eb9a39413d2c39d4286524144546f6b656e73",
    ticker: "RAD",
    category: "gaming",
    minTradeSize: 10,
    maxTradeSize: 200,
    profitTargets: {
      quick: 0.10,
      medium: 0.20,
      long: 0.30
    },
    trailingStop: 0.05
  },
  
  // Stablecoins - tighter ranges for stable assets
  {
    unit: "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61446a65644d6963726f555344",
    ticker: "DJED",
    category: "stable",
    minTradeSize: 10,
    maxTradeSize: 200,
    profitTargets: {
      quick: 0.02,
      medium: 0.05,
      long: 0.08
    },
    trailingStop: 0.02
  },

  // Depin
  {
    unit: "e5a42a1a1d3d1da71b0449663c32798725888d2eb0843c4dabeca05a576f726c644d6f62696c65546f6b656e58",
    ticker: "WMTX",
    category: "depin",
    minTradeSize: 10,
    maxTradeSize: 200,
    profitTargets: {
      quick: 0.10,
      medium: 0.20,
      long: 0.30
    },
    trailingStop: 0.08
  },

  // DeFi
  {
    unit: "da8c30857834c6ae7203935b89278c532b3995245295456f993e1d244c51",
    ticker: "LQ",
    category: "defi",
    minTradeSize: 10,
    maxTradeSize: 200,
    profitTargets: {
      quick: 0.10,
      medium: 0.20,
      long: 0.30
    },
    trailingStop: 0.06
  },
  
  //meme coins
  {
    unit: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b",
    ticker: "SNEK",
    category: "meme_coins",
    minTradeSize: 10,
    maxTradeSize: 200,
    profitTargets: {
      quick: 0.10,
      medium: 0.20,
      long: 0.30
    },
    trailingStop: 0.10
  }
];

// Helper function to get tokens by category
export function getTokensByCategory(category: Category): TokenConfig[] {
  return TRADING_TOKENS.filter(token => token.category === category);
}

// Helper function to get all trading tokens
export function getAllTradingTokens(): TokenConfig[] {
  return TRADING_TOKENS;
}

// Helper function to get token config by unit
export function getTokenConfig(unit: string): TokenConfig | undefined {
  return TRADING_TOKENS.find(token => token.unit === unit);
}

// Helper function to get token config by ticker
export function getTokenConfigByTicker(ticker: string): TokenConfig | undefined {
  return TRADING_TOKENS.find(token => token.ticker === ticker);
} 