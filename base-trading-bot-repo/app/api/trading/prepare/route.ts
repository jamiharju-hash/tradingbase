import { NextResponse } from "next/server"
import { encodeFunctionData, getAddress, isAddress } from "viem"
import { appendBuilderCodeToCalldata } from "@/lib/base/builderCode"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import {
  BASE_SEPOLIA_CHAIN_ID,
  PLACEHOLDER_APPROVAL_SPENDER,
  WETH_BASE_SEPOLIA_ADDRESS,
  deriveTradeSide,
  normalizeSymbol,
  validateTradeRisk,
} from "@/lib/trading/riskEngine"
import type {
  EvmAddress,
  PreparedTradeResponse,
  PrepareTradeRequest,
  SupportedChainId,
  TradeSignal,
} from "@/lib/trading/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_SIGNALS = new Set<TradeSignal>([
  "BUY",
  "SELL",
  "BUY_SMALL",
  "AVOID",
])

const SUPPORTED_REQUEST_CHAIN_IDS = new Set<number>([84532, 8453])

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const

type ParseResult =
  | { ok: true; data: PrepareTradeRequest }
  | { ok: false; status: number; reason: string; errors: string[] }

export async function POST(req: Request) {
  const parsed = await parsePrepareTradeRequest(req)

  if (!parsed.ok) {
    const response: PreparedTradeResponse = {
      executable: false,
      reason: parsed.reason,
      errors: parsed.errors,
    }

    return NextResponse.json(response, { status: parsed.status })
  }

  const riskDecision = validateTradeRisk(parsed.data)

  if (!riskDecision.executable || !riskDecision.riskParams) {
    const response: PreparedTradeResponse = {
      executable: false,
      reason: riskDecision.reason ?? "Trade rejected by risk engine.",
      errors: riskDecision.errors,
    }

    return NextResponse.json(response, { status: 403 })
  }

  const side = deriveTradeSide(parsed.data.signal)

  if (!side) {
    const response: PreparedTradeResponse = {
      executable: false,
      reason: `Unable to derive trade side from signal ${parsed.data.signal}.`,
    }

    return NextResponse.json(response, { status: 400 })
  }

  const rawCalldata = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [PLACEHOLDER_APPROVAL_SPENDER, 0n],
  })

  const {
    calldata,
    builderCodeApplied,
    builderCode,
  } = appendBuilderCodeToCalldata(rawCalldata)

  const normalizedSymbol = normalizeSymbol(parsed.data.symbol)

  try {
    const supabase = getSupabaseAdminClient()

    const { data: insertData, error: insertError } = await supabase
      .from("trade_executions")
      .insert({
        wallet_address: parsed.data.walletAddress,
        chain_id: BASE_SEPOLIA_CHAIN_ID,
        symbol: normalizedSymbol,
        side,
        router_address: PLACEHOLDER_APPROVAL_SPENDER,
        calldata,
        status: "PREPARED",
        max_slippage_bps: riskDecision.riskParams.maxSlippageBps,
        position_usd: riskDecision.riskParams.maxPositionUsd,
        builder_code: builderCode,
        builder_code_applied: builderCodeApplied,
      })
      .select("id")
      .single()

    if (insertError) {
      const response: PreparedTradeResponse = {
        executable: false,
        reason:
          "Trade was approved by risk engine but failed to write PREPARED execution log.",
        errors: [insertError.message],
      }

      return NextResponse.json(response, { status: 500 })
    }

    if (!insertData?.id) {
      const response: PreparedTradeResponse = {
        executable: false,
        reason: "Trade execution log was created but no execution id was returned.",
      }

      return NextResponse.json(response, { status: 500 })
    }

    const response: PreparedTradeResponse = {
      executable: true,
      executionId: insertData.id,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      to: WETH_BASE_SEPOLIA_ADDRESS,
      data: calldata,
      value: "0x0",
      risk: {
        maxSlippageBps: riskDecision.riskParams.maxSlippageBps,
        maxPositionUsd: riskDecision.riskParams.maxPositionUsd,
        mode: "testnet",
      },
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const response: PreparedTradeResponse = {
      executable: false,
      reason: "Trade preparation failed during server-side logging.",
      errors: [error instanceof Error ? error.message : "Unknown server error"],
    }

    return NextResponse.json(response, { status: 500 })
  }
}

async function parsePrepareTradeRequest(req: Request): Promise<ParseResult> {
  let payload: unknown

  try {
    payload = await req.json()
  } catch {
    return {
      ok: false,
      status: 400,
      reason: "Invalid JSON body.",
      errors: ["Request body must be valid JSON."],
    }
  }

  if (!isRecord(payload)) {
    return {
      ok: false,
      status: 400,
      reason: "Invalid request body.",
      errors: ["Request body must be a JSON object."],
    }
  }

  const errors: string[] = []

  const symbol = payload.symbol
  const signal = payload.signal
  const walletAddress = payload.walletAddress
  const chainId = payload.chainId

  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    errors.push("symbol must be a non-empty string.")
  }

  if (!isTradeSignal(signal)) {
    errors.push("signal must be one of BUY, SELL, BUY_SMALL, or AVOID.")
  }

  if (typeof walletAddress !== "string" || !isAddress(walletAddress)) {
    errors.push("walletAddress must be a valid EVM address.")
  }

  let parsedChainId: SupportedChainId | undefined

  if (chainId !== undefined) {
    if (
      typeof chainId !== "number" ||
      !Number.isInteger(chainId) ||
      !SUPPORTED_REQUEST_CHAIN_IDS.has(chainId)
    ) {
      errors.push("chainId must be 84532 or 8453 when provided.")
    } else {
      parsedChainId = chainId as SupportedChainId
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      status: 400,
      reason: "Prepare trade request validation failed.",
      errors,
    }
  }

  return {
    ok: true,
    data: {
      symbol: normalizeSymbol(symbol as string),
      signal: signal as TradeSignal,
      walletAddress: getAddress(walletAddress as string) as EvmAddress,
      chainId: parsedChainId,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTradeSignal(value: unknown): value is TradeSignal {
  return typeof value === "string" && VALID_SIGNALS.has(value as TradeSignal)
}
