export interface CostEstimate {
  tokens_used: number;
  estimated_cost: number;
  confidence_level: 'high' | 'medium' | 'low';
}

const COST_PER_1K_TOKENS = 0.002;
const BYTE_TO_TOKEN_MULTIPLIER = 0.25;

/**
 * Calculates synthetic cost estimates using byte-length formulas
 * Future upgrades will hook this to the actual SDK usage objects.
 */
export function estimateCost(promptString: string, resultHtml: string): CostEstimate {
  // Approximate roughly 4 characters (bytes approx) per token
  const inputBytes = Buffer.byteLength(promptString);
  const outputBytes = Buffer.byteLength(resultHtml);
  
  const estimatedTokens = Math.ceil((inputBytes + outputBytes) * BYTE_TO_TOKEN_MULTIPLIER);
  const cost = (estimatedTokens / 1000) * COST_PER_1K_TOKENS;

  return {
    tokens_used: estimatedTokens,
    estimated_cost: cost,
    confidence_level: 'medium', // Medium since it's heuristic based
  };
}
