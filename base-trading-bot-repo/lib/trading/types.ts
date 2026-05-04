export type HexString = `0x${string}`
export type EvmAddress = `0x${string}`

export type SupportedChainId = 84532 | 8453

export type TradeSignal = "BUY" | "SELL" | "BUY_SMALL" | "AVOID"

export type TradeSide = "BUY" | "SELL"

export type ExecutionStatus =
  | "PREPARED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED"

export type TokenConfig = {
  chainId: SupportedChainId
  address: EvmAddress
  symbol: string
  name: string
  decimals: number
}

export type PrepareTradeRequest = {
  symbol: string
  signal: TradeSignal
  walletAddress: EvmAddress
  requestedPositionUsd?: number
  requestedSlippageBps?: number
  chainId?: SupportedChainId
}

export type PreparedTradeResponse =
  | {
      executable: true
      executionId: string
      chainId: SupportedChainId
      to: EvmAddress
      data: HexString
      value: HexString
      risk: {
        maxSlippageBps: number
        maxPositionUsd: number
        mode: "testnet" | "mainnet"
      }
    }
  | {
      executable: false
      reason: string
      errors?: string[]
    }

export type RiskConfig = {
  mode: "testnet" | "mainnet"
  allowedChainIds: SupportedChainId[]
  allowedSymbols: string[]
  maxPositionUsd: number
  maxSlippageBps: number
  allowMainnetExecution: boolean
}
