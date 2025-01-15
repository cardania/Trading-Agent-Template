// Copy this file to portfolio-settings.ts and customize the values
export type Category = 'stable'
  | 'defi'
  | 'governance'
  | 'other';

/**
 * Target allocation ratios for different asset categories in the portfolio.
 * The sum of all ratios must equal 1 (100%).
 * 
 * @remarks
 * These ratios define the example desired portfolio composition:
 * - stable: 40% allocation for stable assets
 * - defi: 30% allocation for DeFi protocols
 * - governance: 20% allocation for governance tokens
 * - other: 10% allocation for miscellaneous assets
 */

export const TARGET_RATIOS: Record<Category, number> = {
  stable: 0.40,
  defi: 0.30,
  governance: 0.20,
  other: 0.10
};

// Policy IDs for different token categories
export const TOKEN_POLICIES = {
  stable: ['policy1', 'policy2'],
  defi: ['policy3'],
  governance: ['policy4'],
  other: []
};

export function classifyToken(unit: string): Category {
  // Add your classification logic here
  if (TOKEN_POLICIES.stable.some(id => unit.includes(id))) {
    return 'stable';
  }
  if (TOKEN_POLICIES.defi.some(id => unit.includes(id))) {
    return 'defi';
  }
  if (TOKEN_POLICIES.governance.some(id => unit.includes(id))) {
    return 'governance';
  }
  return 'other';
}
