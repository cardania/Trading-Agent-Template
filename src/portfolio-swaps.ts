/**
 * AI Agent trading bot that combines TapTools data, GPT-4 analysis, and Dexter/Iris for Cardano token swaps.
 * 
 * Features:
 * - Fetches top volume tokens and extended market data from TapTools
 * - Uses GPT-4 for trading decisions based on comprehensive market analysis
 * - Executes trades through Dexter & Iris on Cardano DEXes
 * - Implements portfolio management with category-based allocation
 * - Includes safety checks and error handling
 * 
 * Environmental Requirements:
 * @requires TAP_TOOLS_API_KEY - API key for TapTools integration
 * @requires OPENAI_API_KEY - API key for GPT-4 access
 * @requires BLOCKFROST_PROJECT_ID - Blockfrost project ID for Cardano network access
 * @requires SEED_PHRASE - Seed phrase for the trading wallet
 * @requires CARDANO_ADDRESS - (Optional) Address for portfolio monitoring
 * 
 * Core Components:
 * 1. Data Collection: TapTools API integration for market data
 * 2. Analysis: GPT-4 trading decision engine
 * 3. Portfolio Management: Category-based position sizing
 * 4. Execution: Dexter/Iris integration for DEX swaps
 * 
 * Trading Logic:
 * - Monitors top volume tokens on Cardano
 * - Analyzes price, volume, and market structure
 * - Validates trades against portfolio allocations
 * - Executes trades with slippage protection
 * 
 * Safety Features:
 * - Confidence thresholds for trade execution
 * - Portfolio balance checks
 * - Position size limits
 * - Error handling and logging
 * 
 * @example
 * ```typescript
 * // Start the trading bot
 * mainLoop().catch(console.error);
 * ```
 * 
 * @remarks
 * The bot runs in continuous mode with 60-second intervals between iterations.
 * Ensure all environment variables are properly set before running.
 * 
 * @see {@link https://docs.taptools.io} for TapTools API documentation
 * @see {@link https://docs.indigoprotocol.io} for Iris documentation
 */


// 1) ENV & Imports
import 'dotenv/config';
import axios from 'axios';
import OpenAI from 'openai';

// Token source configuration
enum TokenSource {
  PREDEFINED_LIST = 'PREDEFINED_LIST',    // Use only tokens from token-lists.ts
  TOP_VOLUME = 'TOP_VOLUME',              // Use only top volume tokens from TapTools
  COMBINED = 'COMBINED'                   // Use both predefined and top volume tokens
}
// CHOOSE TOKENS TO TRADE WITH TOKENSOURCE, SEE PREDEFINED_LIST IS IN token-lists`
const ACTIVE_TOKEN_SOURCE: TokenSource = TokenSource.PREDEFINED_LIST;

import { AGENT_BIO, AGENT_LORE } from './config/prompts';
import { 
  ANALYSIS_GUIDELINES, 
  DATA_FIELDS, 
  ANALYSIS_STEPS,
  EXPECTED_RESPONSE_FORMAT 
} from './config/analysis-guidelines';


// Dexter 
import {
  Dexter,
  DexterConfig,
  RequestConfig,
  BaseWalletProvider,
  LucidProvider,
  BaseDataProvider,
  BlockfrostProvider,
  TokenRegistryProvider,
  FetchRequest,
  SwapRequest,
  LiquidityPool,
  SundaeSwapV1,
  DexTransaction
} from '@indigo-labs/dexter';

import { 
  Asset as DexterAsset, 
  Token as DexterToken, 
  LiquidityPool as DexterLiquidityPool 
} from '@indigo-labs/dexter';


import {
  IrisApiService,
  Asset,
  LiquidityPool as IrisLiquidityPool,
  Token as IrisToken
} from '@indigo-labs/iris-sdk';

import { 
  Category,
  TARGET_RATIOS as targetRatios,
  classifyToken 
} from './config/portfolio-settings';

import { 
  getAllTradingTokens, 
  TokenConfig, 
  getTokenConfigByTicker,
  getTokenConfig 
} from './token-lists';

///////////////////////////////////////////
// 2) ENV VARS
///////////////////////////////////////////
const {
  TAP_TOOLS_API_KEY,
  OPENAI_API_KEY,
  BLOCKFROST_PROJECT_ID,
  SEED_PHRASE,         // Seed phrase for Agent's wallet
  CARDANO_ADDRESS,     // The user’s Cardano address to check portfolio
} = process.env;

if (!TAP_TOOLS_API_KEY) {
  console.error('Missing TAP_TOOLS_API_KEY in .env');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}
if (!BLOCKFROST_PROJECT_ID) {
  console.error('Missing BLOCKFROST_PROJECT_ID in .env');
  process.exit(1);
}
if (!CARDANO_ADDRESS) {
  console.warn('No CARDANO_ADDRESS provided. Portfolio checks will be skipped.');
}

///////////////////////////////////////////
// 3) Setup Dexter & OpenAI
///////////////////////////////////////////

// OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Dexter Config
const dexterConfig: DexterConfig = {
  shouldFetchMetadata: true,
  shouldFallbackToApi: true,
  shouldSubmitOrders: true,
  metadataMsgBranding: 'TSMarketBot'
};

const requestConfig: RequestConfig = {
  timeout: 10_000,
  retries: 3
};

const dexter = new Dexter(dexterConfig, requestConfig);
const iris = new IrisApiService('https://iris.indigoprotocol.io');

///////////////////////////////////////////
// 4) Setup Providers
///////////////////////////////////////////
async function setupDexterProviders(): Promise<void> {
  // Data Provider
  const dataProvider: BaseDataProvider = new BlockfrostProvider({
    projectId: BLOCKFROST_PROJECT_ID!,
    url: 'https://cardano-mainnet.blockfrost.io/api/v0'
  });
  dexter.withDataProvider(dataProvider);

  // Metadata Provider
  const metadataProvider = new TokenRegistryProvider();
  dexter.withMetadataProvider(metadataProvider);

  if (!SEED_PHRASE) {
    throw new Error('No SEED_PHRASE provided in .env for seed-based wallet approach');
  }
  const seedWords = SEED_PHRASE.trim().split(/\s+/);
  const lucidProvider: BaseWalletProvider = new LucidProvider();

  console.log('[INIT] Loading wallet...')

  await lucidProvider.loadWalletFromSeedPhrase(
    seedWords,
    {
      accountIndex: 0
    }, 
    {
      projectId: BLOCKFROST_PROJECT_ID!,
      url: 'https://cardano-mainnet.blockfrost.io/api/v0'
    }
  );
  console.log('[INIT] Done loading wallet...')

  dexter.withWalletProvider(lucidProvider);
}

///////////////////////////////////////////
// 5) TapTools API Calls
///////////////////////////////////////////
interface TapToolsVolumeToken {
  price: number;
  ticker: string;
  unit: string; 
  volume: number; 
  [key: string]: any;
}

async function taptoolsGetTopVolumeTokens(perPage = 10): Promise<TapToolsVolumeToken[]> {
  try {
    const url = 'https://openapi.taptools.io/api/v1/token/top/volume';
    const resp = await axios.get<TapToolsVolumeToken[]>(url, {
      headers: {
        accept: 'application/json',
        'X-API-Key': TAP_TOOLS_API_KEY!
      }
    });
    return resp.data.slice(0, perPage);
  } catch (err) {
    console.error('Error fetching top volume tokens:', err);
    return [];
  }
}

// Example: address info for portfolio checks
async function taptoolsGetAddressInfo(address: string): Promise<Record<string, any> | null> {
  try {
    const baseUrl = 'https://openapi.taptools.io/api/v1/address/info';
    const resp = await axios.get(baseUrl, {
      headers: {
        accept: 'application/json',
        'X-API-Key': TAP_TOOLS_API_KEY!
      },
      params: { address }
    });
    return resp.data;
  } catch (err) {
    console.error(`Error fetching address info: ${err}`);
    return null;
  }
}

export async function taptoolsGetTokenPrices(units: string[]): Promise<Record<string, number>> {
  try {
    const url = 'https://openapi.taptools.io/api/v1/token/prices';
    const resp = await axios.post(url, units, {
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
        'X-API-Key': TAP_TOOLS_API_KEY!
      },
    });
    return resp.data;
  } catch (err) {
    console.error('Error fetching token prices:', err);
    return {};
  }
}

export async function taptoolsGetTokenPriceChg(unit: string, timeframes = '1h,4h,24h'): Promise<Record<string, number>> {
  try {
    const baseUrl = 'https://openapi.taptools.io/api/v1/token/prices/chg';
    const resp = await axios.get(baseUrl, {
      headers: {
        accept: 'application/json',
        'X-API-Key': TAP_TOOLS_API_KEY!
      },
      params: { unit, timeframes }
    });
    if (resp.status === 200) {
      return resp.data;
    } else {
      console.error(`Error ${resp.status} fetching price change for ${unit}:`, resp.data);
      return {};
    }
  } catch (err) {
    console.error('taptoolsGetTokenPriceChg error:', err);
    return {};
  }
}

export async function taptoolsGetTokenPools(unit: string, adaOnly = 1): Promise<any[]> {
  try {
    const url = 'https://openapi.taptools.io/api/v1/token/pools';
    const resp = await axios.get(url, {
      headers: {
        accept: 'application/json',
        'X-API-Key': TAP_TOOLS_API_KEY!
      },
      params: { unit, adaOnly }
    });
    if (resp.status === 200) {
      return resp.data;
    } else {
      console.error(`Error ${resp.status} fetching pools for ${unit}:`, resp.data);
      return [];
    }
  } catch (err) {
    console.error('taptoolsGetTokenPools error:', err);
    return [];
  }
}

export async function taptoolsGetTokenOhlcv(unit: string, interval = '1d', numIntervals = 30): Promise<any[]> {
  try {
    const url = 'https://openapi.taptools.io/api/v1/token/ohlcv';
    const resp = await axios.get(url, {
      headers: {
        accept: 'application/json',
        'X-API-Key': TAP_TOOLS_API_KEY!
      },
      params: { unit, interval, numIntervals }
    });
    if (resp.status === 200) {
      return resp.data;
    } else {
      console.error(`Error ${resp.status} fetching OHLCV for ${unit}:`, resp.data);
      return [];
    }
  } catch (err) {
    console.error('taptoolsGetTokenOhlcv error:', err);
    return [];
  }
}

export async function taptoolsGetTokenTradingStats(unit: string, timeframe = '24h'): Promise<Record<string, any>> {
  try {
    const url = 'https://openapi.taptools.io/api/v1/token/trading/stats';
    const resp = await axios.get(url, {
      headers: {
        accept: 'application/json',
        'X-API-Key': TAP_TOOLS_API_KEY!
      },
      params: { unit, timeframe }
    });
    if (resp.status === 200) {
      return resp.data;
    } else {
      console.error(`Error ${resp.status} fetching trading stats for ${unit}:`, resp.data);
      return {};
    }
  } catch (err) {
    console.error('taptoolsGetTokenTradingStats error:', err);
    return {};
  }
}

export async function taptoolsGetTokenMcap(unit: string): Promise<Record<string, any>> {
  try {
    const url = 'https://openapi.taptools.io/api/v1/token/mcap';
    const resp = await axios.get(url, {
      headers: {
        accept: 'application/json',
        'X-API-Key': TAP_TOOLS_API_KEY!
      },
      params: { unit }
    });
    if (resp.status === 200) {
      return resp.data;
    } else {
      console.error(`Error ${resp.status} fetching mcap for ${unit}:`, resp.data);
      return {};
    }
  } catch (err) {
    console.error('taptoolsGetTokenMcap error:', err);
    return {};
  }
}

///////////////////////////////////////////
// 6) LLM Decision
///////////////////////////////////////////
interface LlmDecision {
  trade: 'true'|'false';
  direction: 'buy'|'sell';
  confidence: number;
  size: number;
  reasoning: {
    price_analysis: string;
    volume_analysis: string;
    risk_assessment: string;
    confidence_explanation: string;
    size_explanation: string;
    [k: string]: any;
  };
}

async function getLlmTradingDecision(tokenData: any): Promise<LlmDecision> {
  try {
    const systemPrompt = `
        bio: ${JSON.stringify(AGENT_BIO)}
        lore: ${JSON.stringify(AGENT_LORE)}
        
    Data Analysis Guidelines:
    ${Object.entries(ANALYSIS_GUIDELINES)
      .map(([category, guidelines]) => 
        `${category}:\n${guidelines.map(g => `       - ${g}`).join('\n')}`
      ).join('\n\n')}

    Your job: 
      - Evaluate ALL available token data
      - Consider market structure, liquidity, and technical factors
      - Decide whether to buy or sell the token on a DEX
      - Provide comprehensive reasoning in JSON

    Format your response in JSON:
    ${JSON.stringify(EXPECTED_RESPONSE_FORMAT, null, 2)}
    IMPORTANT: Return strictly valid JSON. Do not use triple backticks or code blocks.
    `;

    const userPrompt = `
    Available Data Fields:
    ${Object.entries(DATA_FIELDS)
      .map(([category, fields]) => `- ${category}: ${fields.join(', ')}`)
      .join('\n')}

    Consider ALL data points when making your decision:
    ${ANALYSIS_STEPS.map((step, i) => `${i + 1}. ${step}`).join('\n')}

    Provide a detailed analysis and trading decision.    
    
    Analyze the following token data and respond in strict JSON:
    ${JSON.stringify(tokenData, null, 2)}
    `;

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 1000
    });
    const text = resp.choices[0].message?.content?.trim() || '';
    return JSON.parse(text) as LlmDecision;
  } catch (err) {
    console.error('LLM Decision Error:', err);
    return {
      trade: 'false',
      direction: 'buy',
      confidence: 0,
      size: 0,
      reasoning: {
        price_analysis: 'LLM error',
        volume_analysis: '',
        risk_assessment: '',
        confidence_explanation: '',
        size_explanation: ''
      }
    };
  }
}

///////////////////////////////////////////
// 7) Portfolio Logic
///////////////////////////////////////////

/** 
 * This is a naive approach. 
 * For a buy, we check if we’re above the category limit. 
 * For a sell, we just do it. 
 * You can refine this with more advanced checks.
 */
function adjustTradeForPortfolio(
  direction: 'buy' | 'sell',
  category: Category,
  recommendedAda: number,
  totalAdaValue: number,
  currentCategoryValue: number,
  userAdaBalance: number
): number {
  if (direction === 'buy') {
    const maxAllowedCategory = targetRatios[category] * totalAdaValue;
    const roomLeft = maxAllowedCategory - currentCategoryValue;
    if (roomLeft <= 0) {
      console.log(`[PORTFOLIO] Category ${category} is at/over target ratio. Skipping buy.`);
      return 0;
    }
    // e.g. We can’t exceed the user’s actual ADA minus fees
    const maxUserCanSpend = Math.max(0, userAdaBalance - 2);
    let finalAda = Math.min(recommendedAda, roomLeft, maxUserCanSpend);
    if (finalAda < 1) {
      console.log(`[PORTFOLIO] finalAda < 1, skipping buy.`);
      return 0;
    }
    return finalAda;
  } else {
    // For sells, either you do “sell recommended” or skip if no tokens
    // This example does no advanced token checks. 
    // But you might do a “check user’s token holdings in address info.”
    return recommendedAda;
  }
}

///////////////////////////////////////////
// 8) Dexter “Find Pool & Execute Swap”
///////////////////////////////////////////
async function findDexPoolForToken(unit: string): Promise<LiquidityPool | null> {
  console.log('[DEXTER] Loading pools from Iris...')
  const allPools = await iris.liquidityPools().match({tokenA: 'lovelace', tokenB: Asset.fromIdentifier(unit)});
  console.log('[DEXTER] Done loading pools from Iris...')

  const dexterPools = allPools.data
    .sort((a: IrisLiquidityPool, b: IrisLiquidityPool) => Number((b.state?.tvl ?? 0n) - (a.state?.tvl ?? 0n)))
    .map(toDexterLiquidityPool);

  if (dexterPools.length > 0) {
    return dexterPools[0];
  }
  
  return null;
}

function toDexterLiquidityPool(liquidityPool: IrisLiquidityPool): DexterLiquidityPool {
  let dex: string = liquidityPool.dex;

  if (dex === 'SundaeSwap') {
      dex = SundaeSwapV1.identifier;
  }

  const pool: DexterLiquidityPool = new DexterLiquidityPool(
      dex,
      toDexterToken(liquidityPool.tokenA),
      toDexterToken(liquidityPool.tokenB),
      BigInt(liquidityPool.state?.reserveA ?? 0),
      BigInt(liquidityPool.state?.reserveB ?? 0),
      liquidityPool.address,
      liquidityPool.orderAddress,
      liquidityPool.orderAddress,
  );

  pool.poolFeePercent = liquidityPool.state?.feePercent ?? 0;
  pool.identifier = liquidityPool.identifier;

  if (liquidityPool.lpToken) {
      pool.lpToken = new DexterAsset(liquidityPool.lpToken.policyId, liquidityPool.lpToken.nameHex);
  }
  if (liquidityPool.state && liquidityPool.state.lpToken) {
      pool.lpToken = new DexterAsset(liquidityPool.state.lpToken.policyId, liquidityPool.state.lpToken.nameHex);
  }

  return pool;
}

function toDexterToken(token: IrisToken): DexterToken {
  if (token === 'lovelace') return 'lovelace';

  return new DexterAsset(
      token.policyId,
      token.nameHex,
      token.decimals ?? 0,
  );
}

//TODO: remove?
interface SwapTransactionResult {
  txId: string;
  success: boolean;
  waitForConfirmation(): Promise<{ success: boolean }>;
}


function logToConsoleAndFile(message: string) {
  console.log(message);
}


async function getAssetDecimals(unit: string): Promise<number> {
  try {
    // Split the unit into policyId and nameHex
    const policyId = unit.slice(0, 56);
    const nameHex = unit.slice(56);
    
    const iris = new IrisApiService('https://iris.indigoprotocol.io');
    
    // Use the proper match method from AssetService
    const response = await iris.assets().match({
      policyId,
      nameHex
    });

    if (response.data.length > 0) {
      return response.data[0].decimals || 0;
    }
    
    return 0;
  } catch (err) {
    console.error(`[IRIS] Error fetching decimals for ${unit}:`, err);
    return 0;
  }
}

// Update executeDexSwap with more logging
async function executeDexSwap(
  direction: 'buy'|'sell',
  quantityAda: number,
  unit: string
): Promise<void> {
  try {
    logToConsoleAndFile(`[DEXTER] Starting swap execution for ${unit}`);
    logToConsoleAndFile(`[DEXTER] Direction: ${direction}, Amount: ${quantityAda} ADA`);

    const pool = await findDexPoolForToken(unit);
    if (!pool) {
      logToConsoleAndFile(`[DEXTER] ❌ No valid pool found for ${unit} / ADA`);
      return;
    }

    // Get decimals for the token
    const decimals = await getAssetDecimals(unit);
    logToConsoleAndFile(`[DEXTER] Token decimals: ${decimals}`);

    logToConsoleAndFile(`[DEXTER] ✓ Found pool: ${pool.identifier}`);
    logToConsoleAndFile(`[DEXTER] Pool details: ${JSON.stringify({
      assetA: pool.assetA.toString(),
      assetB: pool.assetB.toString(),
      dex: pool.dex
    }, null, 2)}`);

    const swapReq: SwapRequest = dexter.newSwapRequest()
      .forLiquidityPool(pool)
      .withSlippagePercent(2.0);

    if (direction === 'buy') {
      logToConsoleAndFile('[DEXTER] Configuring buy: ADA → Token');
      swapReq
        .withSwapInToken('lovelace')
        .withSwapInAmount(BigInt(quantityAda * 1_000_000));
      logToConsoleAndFile(`[DEXTER] Set swap in: ${quantityAda} ADA (${quantityAda * 1_000_000} lovelace)`);
    } else {
      logToConsoleAndFile('[DEXTER] Configuring sell: Token → ADA');
      swapReq
        .withSwapOutToken('lovelace')
        .withSwapOutAmount(BigInt(quantityAda * 1_000_000));
      logToConsoleAndFile(`[DEXTER] Set swap out: ${quantityAda} ADA (${quantityAda * 1_000_000} lovelace)`);
    }

    logToConsoleAndFile('[DEXTER] Submitting swap request...');
    const tx = swapReq.submit();
    
    tx
      .onBuilding(() => {
        logToConsoleAndFile('[DEXTER] Building swap order...');
      })
      .onSubmitted((dexterTx: DexTransaction) => {
        logToConsoleAndFile(`[DEXTER] ✓ Swap TX Submitted: ${dexterTx.hash}`);
      })
      .onError((dexterTx: DexTransaction) => {
        logToConsoleAndFile(`[DEXTER] ❌ ${dexterTx.error?.reasonRaw}`);
      });

  } catch (err) {
    logToConsoleAndFile(`[DEXTER] ❌ Swap error for ${unit}:`);
    logToConsoleAndFile(err instanceof Error ? err.stack || err.message : String(err));
  }
}

async function getTopTokens(): Promise<TapToolsVolumeToken[]> {
  let combinedTokens: TapToolsVolumeToken[] = [];

  // Get predefined tokens if needed
  if (ACTIVE_TOKEN_SOURCE === TokenSource.PREDEFINED_LIST || ACTIVE_TOKEN_SOURCE === TokenSource.COMBINED) {
    const tradingTokens = getAllTradingTokens();
    console.log('=== [BOT] Using configured trading tokens ===');
    const configuredTokens = tradingTokens.map(token => ({
      ticker: token.ticker,
      unit: token.unit,
      price: 0, // Will be populated later
      volume: 0 // Will be populated later
    }));
    console.log('[BOT] Configured tokens:', configuredTokens.map(t => t.ticker));
    combinedTokens.push(...configuredTokens);
  }

  // Get top volume tokens if needed
  if (ACTIVE_TOKEN_SOURCE === TokenSource.TOP_VOLUME || ACTIVE_TOKEN_SOURCE === TokenSource.COMBINED) {
    console.log('=== [BOT] Fetching top volume tokens from TapTools ===');
    const topVolumeTokens = await taptoolsGetTopVolumeTokens(10);
    console.log('[BOT] Top volume tokens:', topVolumeTokens.map(t => t.ticker));
    
    // Only add non-duplicate tokens
    for (const token of topVolumeTokens) {
      if (!combinedTokens.some(t => t.unit === token.unit)) {
        combinedTokens.push(token);
      }
    }
  }

  // Get prices for tokens that don't have them
  const tokenUnits = combinedTokens
    .filter(t => t.price === 0)
    .map(t => t.unit);
  if (tokenUnits.length > 0) {
    const prices = await taptoolsGetTokenPrices(tokenUnits);
    for (const token of combinedTokens) {
      if (token.price === 0) {
        token.price = prices[token.unit] || 0;
      }
    }
  }

  console.log(`[BOT] Total unique tokens to monitor: ${combinedTokens.length}`);
  console.log(`[BOT] Using token source: ${ACTIVE_TOKEN_SOURCE}`);
  return combinedTokens;
}

// Helper to get token info by unit
function getTokenInfo(unit: string): TokenConfig | undefined {
  // First check our predefined list
  const configuredToken = getTokenConfigByTicker(unit);
  if (configuredToken) {
    return configuredToken;
  }

  // If not in predefined list, create a basic config
  return {
    unit,
    ticker: unit.slice(0, 10) + '...', // Truncated unit as fallback ticker
    category: 'other', // Default category
    minTradeSize: 10,
    maxTradeSize: 200,
    profitTargets: {
      quick: 0.10,
      medium: 0.20,
      long: 0.30
    },
    trailingStop: 0.05
  };
}

// Add color constants at the top with other imports
const COLORS = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
};

// Category colors mapping
const CATEGORY_COLORS: Record<Category, string> = {
  ada: COLORS.blue,
  stable: COLORS.green,
  defi: COLORS.magenta,
  ai: COLORS.cyan,
  gaming: COLORS.yellow,
  meme_coins: COLORS.red,
  depin: COLORS.green,
  other: COLORS.white
};

// Update the portfolio value breakdown to match our categories
function logPortfolioBreakdown(portfolioValues: Record<Category, number>, totalValue: number) {
  console.log(`\n${COLORS.bold}[PORTFOLIO] Value Breakdown:${COLORS.reset}`);
  
  // Get all categories from the Category type
  const categories: Category[] = ['ada', 'stable', 'defi', 'ai', 'gaming', 'meme_coins', 'depin', 'other'];
  
  categories.forEach(category => {
    const categoryValue = portfolioValues[category];
    const percentage = totalValue > 0 ? (categoryValue / totalValue * 100).toFixed(2) : '0.00';
    const color = CATEGORY_COLORS[category];
    
    // Format the values with colors
    const categoryName = `${color}${category.padEnd(12)}${COLORS.reset}`;
    const valueStr = `${color}${categoryValue.toFixed(2).padStart(12)} ADA${COLORS.reset}`;
    const percentStr = `${color}(${percentage.padStart(6)}%)${COLORS.reset}`;
    
    console.log(`  ${categoryName}: ${valueStr} ${percentStr}`);
  });
  
  // Print total with bold cyan
  console.log(`\n${COLORS.bold}${COLORS.cyan}[PORTFOLIO] Total Value: ${totalValue.toFixed(2)} ADA${COLORS.reset}\n`);
}

async function loop() {
    try {
      // Get combined list of configured and top volume tokens
      const tokens = await getTopTokens();
      if (!tokens.length) {
        console.log('[BOT] No tokens returned. Skipping iteration.');
        return;
      }

      // If we do portfolio checks:
      let addressInfo: Record<string, any> | null = null;
      if (CARDANO_ADDRESS) {
        addressInfo = await taptoolsGetAddressInfo(CARDANO_ADDRESS);
      }

      // Parse user's portfolio if we have address info
      let totalAdaValue = 0;
      const categoryValues: Record<Category, number> = {
        ada: 0,
        stable: 0,
        defi: 0,
        ai: 0,
        gaming: 0,
        meme_coins: 0,
        depin: 0,
        other: 0,
      };

      if (addressInfo) {
        // 1. Start with ADA balance
        const adaStr = addressInfo.lovelace || '0';
        const userAda = parseInt(adaStr, 10) / 1_000_000;
        categoryValues.ada = userAda;
        totalAdaValue += userAda;

        // 2. Get all token units we need prices for
        const allUnitsInWallet: string[] = [];
        if (addressInfo.assets) {
          for (const asset of addressInfo.assets) {
            allUnitsInWallet.push(asset.unit);
          }
        }

        // 3. Fetch all token prices in one batch call
        const tokenPrices = await taptoolsGetTokenPrices(allUnitsInWallet);
        
        // 4. Calculate value for each token and add to proper category
        if (addressInfo.assets) {
          for (const asset of addressInfo.assets) {
            const price = tokenPrices[asset.unit] || 0;
            if (price <= 0) continue;
            
            // Get token info and decimals
            const tokenInfo = getTokenConfig(asset.unit);
            const decimals = tokenInfo?.decimals || await getAssetDecimals(asset.unit);
            
            // Calculate proper quantity using decimals
            const quantity = parseInt(asset.quantity, 10) / Math.pow(10, decimals);
            const valueInAda = quantity * price;
            
            // Determine category and add value
            const category = tokenInfo?.category || 'other';
            categoryValues[category] += valueInAda;
            totalAdaValue += valueInAda;
          }
        }
        
        // Log the breakdown with colors
        logPortfolioBreakdown(categoryValues, totalAdaValue);
      }

      // For each token, fetch advanced data and analyze:
      for (const tokenInfo of tokens) {
        const { ticker, unit, price, volume } = tokenInfo;
        const tokenData: any = {
          ticker,
          unit,
          volume_24h: volume,
          price
        };

        // Add advanced data from TapTools
        tokenData.aggregated_price = (await taptoolsGetTokenPrices([unit]))[unit] ?? null;
        tokenData.price_change = await taptoolsGetTokenPriceChg(unit, '1h,4h,24h');
        tokenData.pools = await taptoolsGetTokenPools(unit, 1);
        tokenData.ohlcv = await taptoolsGetTokenOhlcv(unit, '1h', 24);
        tokenData.trading_stats = await taptoolsGetTokenTradingStats(unit, '24h');
        tokenData.mcap = await taptoolsGetTokenMcap(unit);

        const decision = await getLlmTradingDecision(tokenData);
        console.log(`[LLM] Decision for ${ticker}:`, decision);

        if (decision.trade === 'false') {
          console.log(`[BOT] Skipping ${ticker}, no trade recommended.`);
          continue;
        }
        if (decision.confidence < 0.6) {
          console.log(`[BOT] Skipping ${ticker}, confidence only ${decision.confidence}`);
          continue;
        }

        // Get token configuration for sizing and category
        const tokenConfig = getTokenInfo(unit);
        if (!tokenConfig) {
          console.log(`[BOT] No token config found for ${ticker}, skipping`);
          continue;
        }

        // Use dynamic sizing between token's min and max trade size
        const minSize = tokenConfig.minTradeSize || 50;
        const maxSize = tokenConfig.maxTradeSize || 500;
        let recommended = Math.min(Math.max(decision.size || minSize, minSize), maxSize);
        let finalAmount = recommended;

        if (addressInfo) {
          const catValueNow = categoryValues[tokenConfig.category];
          const userAdaBal = categoryValues.ada; 
          finalAmount = adjustTradeForPortfolio(
            decision.direction,
            tokenConfig.category,
            recommended,
            totalAdaValue,
            catValueNow,
            userAdaBal
          );          
          if (finalAmount < 1) {            
            console.log('[BOT] finalAmount < 1, skipping trade');            
            continue;          
          }        
        }        
        console.log(`[BOT] Executing ${decision.direction.toUpperCase()} of ${finalAmount} ADA for token ${ticker}`);        
        await executeDexSwap(decision.direction, finalAmount, unit);      
      }    
    } catch (err) {      
      console.error('[BOT] Main Loop Error:', err);    
    }  
}

///////////////////////////////////////////
// 9) The Main Logic Loop
///////////////////////////////////////////
async function mainLoop(): Promise<void> {
  console.log('[INIT] Setting up Dexter & Providers...');
  await setupDexterProviders();

  await loop();

  setInterval(loop, 60_000); // run every 60s
}

///////////////////////////////////////////
// 10) Start
///////////////////////////////////////////
mainLoop().catch(console.error);