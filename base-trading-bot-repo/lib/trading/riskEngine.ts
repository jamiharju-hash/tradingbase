import type {
  EvmAddress,
  PrepareTradeRequest,
  RiskConfig,
  TradeSide,
  TradeSignal,
} from "@/lib/trading/types"

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const

export const WETH_BASE_SEPOLIA_ADDRESS: EvmAddress =
  "0x4200000000000000000000000000000000000006"

export const PLACEHOLDER_APPROVAL_SPENDER: EvmAddress =
  "0x000000000000000000000000000000000000dEaD"

export const HARD_RISK_LIMITS = {
  maxPositionUsd: 100,
  maxSlippageBps: 50,
  allowedSymbols: ["WETH", "WETH/USDC"],
  allowedChainIds: [BASE_SEPOLIA_CHAIN_ID],
} as const

const EXECUTABLE_SIGNALS = new Set<TradeSignal>([
  "BUY",
  "SELL",
  "BUY_SMALL",
])

export type RiskValidationResult = {
  executable: boolean
  reason?: string
  errors?: string[]
  riskParams?: {
    maxSlippageBps: number
    maxPositionUsd: number
  }
}

export function getDefaultRiskConfig(): RiskConfig {
  const executionMode = process.env.TRADING_EXECUTION_MODE ?? "testnet"

  return {
    mode: executionMode === "testnet" ? "testnet" : "mainnet",
    allowedChainIds: [BASE_SEPOLIA_CHAIN_ID],
    allowedSymbols: [...HARD_RISK_LIMITS.allowedSymbols],
    maxPositionUsd: HARD_RISK_LIMITS.maxPositionUsd,
    maxSlippageBps: HARD_RISK_LIMITS.maxSlippageBps,
    allowMainnetExecution: false,
  }
}

export function validateTradeRisk(
  request: PrepareTradeRequest,
  config: RiskConfig = getDefaultRiskConfig()
): RiskValidationResult {
  const errors: string[] = []
  const normalizedSymbol = normalizeSymbol(request.symbol)
  const requestedChainId = request.chainId ?? BASE_SEPOLIA_CHAIN_ID

  const riskParams = {
    maxSlippageBps: config.maxSlippageBps,
    maxPositionUsd: config.maxPositionUsd,
  }

  if (config.mode !== "testnet") {
    errors.push("Execution mode is not testnet. Mainnet execution is disabled.")
  }

  if (config.allowMainnetExecution) {
    errors.push("Mainnet execution flag must remain disabled for this flow.")
  }

  if (!EXECUTABLE_SIGNALS.has(request.signal)) {
    errors.push(`Signal ${request.signal} is not executable.`)
  }

  if (!deriveTradeSide(request.signal)) {
    errors.push(`Cannot derive trade side from signal ${request.signal}.`)
  }

  if (!config.allowedSymbols.includes(normalizedSymbol)) {
    errors.push(
      `Symbol ${normalizedSymbol} is not allowlisted. Allowed symbols: ${config.allowedSymbols.join(", ")}.`
    )
  }

  if (!config.allowedChainIds.includes(requestedChainId)) {
    errors.push(
      `Chain ${requestedChainId} is not allowlisted. Only Base Sepolia ${BASE_SEPOLIA_CHAIN_ID} is enabled.`
    )
  }

  if (requestedChainId !== BASE_SEPOLIA_CHAIN_ID) {
    errors.push("Only Base Sepolia execution is allowed.")
  }

  if (config.maxPositionUsd > HARD_RISK_LIMITS.maxPositionUsd) {
    errors.push(
      `Configured max position exceeds hard cap of ${HARD_RISK_LIMITS.maxPositionUsd} USD.`
    )
  }

  if (config.maxSlippageBps > HARD_RISK_LIMITS.maxSlippageBps) {
    errors.push(
      `Configured max slippage exceeds hard cap of ${HARD_RISK_LIMITS.maxSlippageBps} bps.`
    )
  }

  if (errors.length > 0) {
    return {
      executable: false,
      reason: "Risk validation failed.",
      errors,
      riskParams,
    }
  }

  return {
    executable: true,
    riskParams,
  }
}

export function deriveTradeSide(signal: TradeSignal): TradeSide | null {
  if (signal === "BUY" || signal === "BUY_SMALL") return "BUY"
  if (signal === "SELL") return "SELL"
  return null
}

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}
