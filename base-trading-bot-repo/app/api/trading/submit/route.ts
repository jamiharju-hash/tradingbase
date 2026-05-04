import { NextResponse } from "next/server"
import { getAddress, isAddress } from "viem"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import type {
  EvmAddress,
  ExecutionStatus,
  SupportedChainId,
} from "@/lib/trading/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_SEPOLIA_CHAIN_ID = 84532 as const
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type SubmitTradeRequest = {
  executionId: string
  txHash: EvmAddress
  walletAddress: EvmAddress
  chainId: SupportedChainId
}

type SubmitTradeResponse =
  | {
      submitted: true
      executionId: string
      txHash: EvmAddress
      status: Extract<ExecutionStatus, "SUBMITTED">
      submittedAt: string
      idempotent?: boolean
    }
  | {
      submitted: false
      reason: string
      errors?: string[]
    }

type TradeExecutionRow = {
  id: string
  wallet_address: string
  chain_id: number
  tx_hash: string | null
  status: ExecutionStatus
  submitted_at: string | null
}

type ParseResult =
  | { ok: true; data: SubmitTradeRequest }
  | { ok: false; status: number; reason: string; errors: string[] }

export async function POST(req: Request) {
  const parsed = await parseSubmitTradeRequest(req)

  if (!parsed.ok) {
    const response: SubmitTradeResponse = {
      submitted: false,
      reason: parsed.reason,
      errors: parsed.errors,
    }

    return NextResponse.json(response, { status: parsed.status })
  }

  try {
    const supabase = getSupabaseAdminClient()

    const { data: existingExecution, error: selectError } = await supabase
      .from("trade_executions")
      .select("id,wallet_address,chain_id,tx_hash,status,submitted_at")
      .eq("id", parsed.data.executionId)
      .single()

    if (selectError || !existingExecution) {
      const response: SubmitTradeResponse = {
        submitted: false,
        reason: "Execution record was not found.",
        errors: selectError ? [selectError.message] : undefined,
      }

      return NextResponse.json(response, { status: 404 })
    }

    const row = existingExecution as TradeExecutionRow
    const ownershipError = validateExecutionOwnership(row, parsed.data)

    if (ownershipError) {
      const response: SubmitTradeResponse = {
        submitted: false,
        reason: "Submitted transaction does not match the prepared execution.",
        errors: [ownershipError],
      }

      return NextResponse.json(response, { status: 403 })
    }

    if (
      row.status === "SUBMITTED" &&
      normalizeHex(row.tx_hash) === normalizeHex(parsed.data.txHash)
    ) {
      const response: SubmitTradeResponse = {
        submitted: true,
        executionId: row.id,
        txHash: parsed.data.txHash,
        status: "SUBMITTED",
        submittedAt: row.submitted_at ?? new Date().toISOString(),
        idempotent: true,
      }

      return NextResponse.json(response, { status: 200 })
    }

    if (row.status !== "PREPARED") {
      const response: SubmitTradeResponse = {
        submitted: false,
        reason: `Execution cannot transition from ${row.status} to SUBMITTED.`,
        errors: ["Only PREPARED executions can be marked as SUBMITTED."],
      }

      return NextResponse.json(response, { status: 409 })
    }

    const submittedAt = new Date().toISOString()

    const { data: updatedExecution, error: updateError } = await supabase
      .from("trade_executions")
      .update({
        tx_hash: parsed.data.txHash,
        status: "SUBMITTED",
        submitted_at: submittedAt,
      })
      .eq("id", parsed.data.executionId)
      .eq("wallet_address", parsed.data.walletAddress)
      .eq("chain_id", parsed.data.chainId)
      .eq("status", "PREPARED")
      .select("id,tx_hash,status,submitted_at")
      .single()

    if (updateError || !updatedExecution) {
      const response: SubmitTradeResponse = {
        submitted: false,
        reason: "Failed to mark execution as SUBMITTED.",
        errors: updateError ? [updateError.message] : undefined,
      }

      return NextResponse.json(response, { status: 500 })
    }

    const response: SubmitTradeResponse = {
      submitted: true,
      executionId: updatedExecution.id,
      txHash: parsed.data.txHash,
      status: "SUBMITTED",
      submittedAt: updatedExecution.submitted_at ?? submittedAt,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const response: SubmitTradeResponse = {
      submitted: false,
      reason: "Submit route failed during server-side processing.",
      errors: [error instanceof Error ? error.message : "Unknown server error"],
    }

    return NextResponse.json(response, { status: 500 })
  }
}

async function parseSubmitTradeRequest(req: Request): Promise<ParseResult> {
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
  const executionId = payload.executionId
  const txHash = payload.txHash
  const walletAddress = payload.walletAddress
  const chainId = payload.chainId

  if (typeof executionId !== "string" || !UUID_REGEX.test(executionId)) {
    errors.push("executionId must be a valid UUID.")
  }

  if (typeof txHash !== "string" || !TX_HASH_REGEX.test(txHash)) {
    errors.push("txHash must be a valid 32-byte transaction hash.")
  }

  if (typeof walletAddress !== "string" || !isAddress(walletAddress)) {
    errors.push("walletAddress must be a valid EVM address.")
  }

  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    errors.push(`chainId must be Base Sepolia ${BASE_SEPOLIA_CHAIN_ID}.`)
  }

  if (errors.length > 0) {
    return {
      ok: false,
      status: 400,
      reason: "Submit trade request validation failed.",
      errors,
    }
  }

  return {
    ok: true,
    data: {
      executionId: executionId as string,
      txHash: normalizeHex(txHash as string) as EvmAddress,
      walletAddress: getAddress(walletAddress as string) as EvmAddress,
      chainId: BASE_SEPOLIA_CHAIN_ID,
    },
  }
}

function validateExecutionOwnership(
  row: TradeExecutionRow,
  request: SubmitTradeRequest
): string | null {
  if (getAddress(row.wallet_address) !== request.walletAddress) {
    return "walletAddress does not match the prepared execution."
  }

  if (row.chain_id !== request.chainId) {
    return "chainId does not match the prepared execution."
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeHex(value: string | null | undefined) {
  return value?.toLowerCase() ?? null
}
