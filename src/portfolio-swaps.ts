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
import axios, { AxiosError } from 'axios';
import OpenAI from 'openai';
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

async function loop() {
    try {
      console.log('\n=== [BOT] Fetching top tokens from TapTools ===');
      const topTokens = await taptoolsGetTopVolumeTokens(10);
      if (!topTokens.length) {
        console.log('[BOT] No tokens returned. Skipping iteration.');
        return;
      }
      console.log('[BOT] Top tokens:', topTokens.map(t=>t.ticker));

      // If we do portfolio checks:
      let addressInfo: Record<string, any> | null = null;
      if (CARDANO_ADDRESS) {
        addressInfo = await taptoolsGetAddressInfo(CARDANO_ADDRESS);
      }

      // Parse user's portfolio if we have address info
      let totalAdaValue = 0;
      const categoryValues: Record<Category, number> = {
        ada: 0,
        meme_coins: 0,
        shards_talos: 0,
        indy: 0,
        big_others: 0,
        new_positions: 0
      };

      if (addressInfo) {
        // 1. Start with ADA balance
        const adaStr = addressInfo.lovelace || '0';
        const userAda = parseInt(adaStr, 10) / 1_000_000;
        categoryValues.ada = userAda;

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
            
            const quantity = parseInt(asset.quantity, 10);
            const valueInAda = quantity * price;
            
            // Add value to proper category
            const category = classifyToken(asset.unit);
            categoryValues[category] += valueInAda;
          }
        }

        // 5. Sum total portfolio value
        totalAdaValue = Object.values(categoryValues).reduce((a,b) => a + b, 0);
        
        // Log the breakdown
        console.log('[PORTFOLIO] Value Breakdown:');
        for (const [cat, value] of Object.entries(categoryValues)) {
          const percentage = totalAdaValue > 0 ? ((value / totalAdaValue) * 100).toFixed(2) : '0.00';
          console.log(`  ${cat}: ${value.toFixed(2)} ADA (${percentage}%)`);
        }
        console.log(`[PORTFOLIO] Total Value: ${totalAdaValue.toFixed(2)} ADA`);
      }

      // For each top token, fetch advanced data:
      for (const tokenInfo of topTokens) {
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

        // Use dynamic sizing between 50-500 ADA
        let recommended = Math.min(Math.max(decision.size || 50, 50), 500);
        let finalAmount = recommended;

        if (addressInfo) {
          // Decide category for portfolio 
          const cat = classifyToken(unit);
          const catValueNow = categoryValues[cat];
          const userAdaBal = categoryValues.ada; 
          finalAmount = adjustTradeForPortfolio(
            decision.direction,
            cat,
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