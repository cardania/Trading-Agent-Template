import {
  Dexter,
  DexterConfig,
  RequestConfig,
  BaseWalletProvider,
  LucidProvider,
  BaseDataProvider,
  BlockfrostProvider,
  TokenRegistryProvider,
  SwapRequest,
  LiquidityPool,
  DexTransaction
} from '@indigo-labs/dexter';

import { 
  Asset as DexterAsset,
  Token as DexterToken
} from '@indigo-labs/dexter';

import {
  IrisApiService,
  Asset,
  LiquidityPool as IrisLiquidityPool,
  Token as IrisToken
} from '@indigo-labs/iris-sdk';

export class DexterService {
  private _dexter: Dexter;
  private _iris: IrisApiService;

  constructor() {
    this._iris = new IrisApiService('https://iris.indigoprotocol.io');
  }

  // Expose getters for the instances
  get dexter(): Dexter {
    return this._dexter;
  }

  get iris(): IrisApiService {
    return this._iris;
  }

  async initialize(blockfrostProjectId: string, seedPhrase?: string) {
    // Dexter Config
    const dexterConfig: DexterConfig = {
      shouldFetchMetadata: true,
      shouldFallbackToApi: true,
      shouldSubmitOrders: false,
      metadataMsgBranding: 'TSMarketBot'
    };

    const requestConfig: RequestConfig = {
      timeout: 10_000,
      retries: 3
    };

    this._dexter = new Dexter(dexterConfig, requestConfig);

    // Data Provider
    const dataProvider: BaseDataProvider = new BlockfrostProvider({
      projectId: blockfrostProjectId,
      url: 'https://cardano-mainnet.blockfrost.io/api/v0'
    });
    this._dexter.withDataProvider(dataProvider);

    // Metadata Provider
    const metadataProvider = new TokenRegistryProvider();
    this._dexter.withMetadataProvider(metadataProvider);

    // Wallet Provider (if seed phrase provided)
    if (seedPhrase) {
      const seedWords = seedPhrase.trim().split(/\s+/);
      const lucidProvider: BaseWalletProvider = new LucidProvider();
      
      await lucidProvider.loadWalletFromSeedPhrase(
        seedWords,
        {
          accountIndex: 0
        },
        {
          projectId: blockfrostProjectId,
          url: 'https://cardano-mainnet.blockfrost.io/api/v0'
        }
      );
      
      this._dexter.withWalletProvider(lucidProvider);
    }
  }

  async findPoolForToken(unit: string): Promise<LiquidityPool | null> {
    const allPools = await this.iris.liquidityPools().match({
      tokenA: 'lovelace',
      tokenB: Asset.fromIdentifier(unit)
    });

    const dexterPools = allPools.data
      .sort((a: IrisLiquidityPool, b: IrisLiquidityPool) => 
        Number((b.state?.tvl ?? 0n) - (a.state?.tvl ?? 0n)))
      .map(this.toDexterLiquidityPool);

    return dexterPools.length > 0 ? dexterPools[0] : null;
  }

  async getAssetDecimals(unit: string): Promise<number> {
    try {
      const policyId = unit.slice(0, 56);
      const nameHex = unit.slice(56);
      
      const response = await this.iris.assets().match({
        policyId,
        nameHex
      });

      return response.data[0]?.decimals || 0;
    } catch (err) {
      console.error(`Error fetching decimals for ${unit}:`, err);
      return 0;
    }
  }

  async executeSwap(
    direction: 'buy' | 'sell',
    quantityAda: number,
    unit: string
  ): Promise<void> {
    try {
      console.log(`[DEXTER] Starting ${direction} swap for ${unit}`);
      
      const pool = await this.findPoolForToken(unit);
      if (!pool) {
        console.log(`[DEXTER] No valid pool found for ${unit} / ADA`);
        return;
      }

      const decimals = await this.getAssetDecimals(unit);
      console.log(`[DEXTER] Token decimals: ${decimals}`);

      const swapReq: SwapRequest = this._dexter.newSwapRequest()
        .forLiquidityPool(pool)
        .withSlippagePercent(2.0);

      if (direction === 'buy') {
        swapReq
          .withSwapInToken('lovelace')
          .withSwapInAmount(BigInt(quantityAda * 1_000_000));
      } else {
        swapReq
          .withSwapOutToken('lovelace')
          .withSwapOutAmount(BigInt(quantityAda * 1_000_000));
      }

      const tx = swapReq.submit();
      
      tx
        .onBuilding(() => {
          console.log('[DEXTER] Building swap order...');
        })
        .onSubmitted((dexterTx: DexTransaction) => {
          console.log(`[DEXTER] Swap TX Submitted: ${dexterTx.hash}`);
        })
        .onError((dexterTx: DexTransaction) => {
          console.log(`[DEXTER] Error: ${dexterTx.error?.reasonRaw}`);
        });

    } catch (err) {
      console.error(`[DEXTER] Swap error for ${unit}:`, err);
    }
  }

  private toDexterLiquidityPool(liquidityPool: IrisLiquidityPool): LiquidityPool {
    const pool: LiquidityPool = new LiquidityPool(
      liquidityPool.dex,
      this.toDexterToken(liquidityPool.tokenA),
      this.toDexterToken(liquidityPool.tokenB),
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

  private toDexterToken(token: IrisToken): DexterToken {
    if (token === 'lovelace') return 'lovelace';

    return new DexterAsset(
      token.policyId,
      token.nameHex,
      token.decimals ?? 0,
    );
  }
} 