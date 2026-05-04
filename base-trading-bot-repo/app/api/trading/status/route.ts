import { NextResponse } from "next/server"
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Hash,
} from "viem"
import { baseSepolia } from "viem/chains"
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

type StatusRequest = {
  executionId: string
  txHash: EvmAddress
  walletAddress?: EvmAddress
  chainId?: SupportedChainId
}

type StatusResponse =
  | {
      updated: true
      executionId: string
      txHash: EvmAddress
      status: Extract<ExecutionStatus, "CONFIRMED" | "FAILED">
      confirmedAt: string
      blockNumber: string
      gasUsed: string
      idempotent?: boolean
    }
  | {
      updated: false
      executionId?: string
      txHash?: EvmAddress
      status?: ExecutionStatus | "PENDING"
      reason: string
      errors?: string[]
    }

type TradeExecutionRow = {
  id: string
  wallet_address: string
  chain_id: number
  tx_hash: string | null
  status: ExecutionStatus
  calldata: string | null
  submitted_at: string | null
  confirmed_at: string | null
  error_message: string | null
}

type ParseResult =
  | { ok: true; data: StatusRequest }
  | { ok: false; status: number; reason: string; errors: string[] }

export async function POST(req: Request) {
  const parsed = await parseStatusRequest(req)

  if (!parsed.ok) {
    const response: StatusResponse = {
      updated: false,
      reason: parsed.reason,
      errors: parsed.errors,
    }

    return NextResponse.json(response, { status: parsed.status })
  }

  try {
    const supabase = getSupabaseAdminClient()

    const { data: executionData, error: selectError } = await supabase
      .from("trade_executions")
      .select("id,wallet_address,chain_id,tx_hash,status,calldata,submitted_at,confirmed_at,error_message")
      .eq("id", parsed.data.executionId)
      .single()

    if (selectError || !executionData) {
      const response: StatusResponse = {
        updated: false,
        executionId: parsed.data.executionId,
        txHash: parsed.data.txHash,
        reason: "Execution record was not found.",
        errors: selectError ? [selectError.message] : undefined,
      }

      return NextResponse.json(response, { status: 404 })
    }

    const execution = executionData as TradeExecutionRow
    const rowValidationError = validateExecutionRow(execution, parsed.data)

    if (rowValidationError) {
      const response: StatusResponse = {
        updated: false,
        executionId: parsed.data.executionId,
        txHash: parsed.data.txHash,
        status: execution.status,
        reason: "Status request does not match the submitted execution.",
        errors: [rowValidationError],
      }

      return NextResponse.json(response, { status: 403 })
    }

    if (execution.status === "CONFIRMED" || execution.status === "FAILED") {
      const response: StatusResponse = {
        updated: true,
        executionId: execution.id,
        txHash: parsed.data.txHash,
        status: execution.status,
        confirmedAt: execution.confirmed_at ?? new Date().toISOString(),
        blockNumber: "0",
        gasUsed: "0",
        idempotent: true,
      }

      return NextResponse.json(response, { status: 200 })
    }

    if (execution.status !== "SUBMITTED") {
      const response: StatusResponse = {
        updated: false,
        executionId: execution.id,
        txHash: parsed.data.txHash,
        status: execution.status,
        reason: `Execution cannot be verified from status ${execution.status}.`,
        errors: ["Only SUBMITTED executions can transition to CONFIRMED or FAILED."],
      }

      return NextResponse.json(response, { status: 409 })
    }

    const publicClient = createBaseSepoliaClient()

    const receiptResult = await getReceiptSafely(publicClient, parsed.data.txHash)

    if (!receiptResult.found) {
      const response: StatusResponse = {
        updated: false,
        executionId: execution.id,
        txHash: parsed.data.txHash,
        status: "PENDING",
        reason: "Transaction receipt is not available yet.",
      }

      return NextResponse.json(response, { status: 202 })
    }

    const transactionResult = await getTransactionSafely(publicClient, parsed.data.txHash)

    if (!transactionResult.found) {
      const response: StatusResponse = {
        updated: false,
        executionId: execution.id,
        txHash: parsed.data.txHash,
        status: "PENDING",
        reason: "Transaction was submitted but full transaction data is not available yet.",
      }

      return NextResponse.json(response, { status: 202 })
    }

    const chainVerificationError = verifyOnchainTransaction({
      execution,
      request: parsed.data,
      receipt: receiptResult.receipt,
      transaction: transactionResult.transaction,
    })

    if (chainVerificationError) {
      return await markExecutionFailed(
        supabase,
        execution.id,
        parsed.data.txHash,
        chainVerificationError,
        receiptResult.receipt.blockNumber.toString(),
        receiptResult.receipt.gasUsed.toString()
      )
    }

    const nextStatus: Extract<ExecutionStatus, "CONFIRMED" | "FAILED"> =
      receiptResult.receipt.status === "success" ? "CONFIRMED" : "FAILED"

    const confirmedAt = new Date().toISOString()

    const { data: updatedExecution, error: updateError } = await supabase
      .from("trade_executions")
      .update({
        status: nextStatus,
        confirmed_at: confirmedAt,
        error_message:
          nextStatus === "FAILED" ? "Transaction receipt status is reverted." : null,
      })
      .eq("id", execution.id)
      .eq("tx_hash", parsed.data.txHash)
      .eq("status", "SUBMITTED")
      .select("id,status,confirmed_at")
      .single()

    if (updateError || !updatedExecution) {
      const response: StatusResponse = {
        updated: false,
        executionId: execution.id,
        txHash: parsed.data.txHash,
        status: execution.status,
        reason: "Failed to update execution status after onchain verification.",
        errors: updateError ? [updateError.message] : undefined,
      }

      return NextResponse.json(response, { status: 500 })
    }

    const response: StatusResponse = {
      updated: true,
      executionId: updatedExecution.id,
      txHash: parsed.data.txHash,
      status: nextStatus,
      confirmedAt: updatedExecution.confirmed_at ?? confirmedAt,
      blockNumber: receiptResult.receipt.blockNumber.toString(),
      gasUsed: receiptResult.receipt.gasUsed.toString(),
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const response: StatusResponse = {
      updated: false,
      reason: "Status route failed during server-side chain verification.",
      errors: [error instanceof Error ? error.message : "Unknown server error"],
    }

    return NextResponse.json(response, { status: 500 })
  }
}

async function markExecutionFailed(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  executionId: string,
  txHash: EvmAddress,
  errorMessage: string,
  blockNumber: string,
  gasUsed: string
) {
  const confirmedAt = new Date().toISOString()

  const { data: failedExecution } = await supabase
    .from("trade_executions")
    .update({
      status: "FAILED",
      error_message: errorMessage,
      confirmed_at: confirmedAt,
    })
    .eq("id", executionId)
    .eq("status", "SUBMITTED")
    .select("id,status,confirmed_at")
    .single()

  const response: StatusResponse = {
    updated: true,
    executionId,
    txHash,
    status: "FAILED",
    confirmedAt: failedExecution?.confirmed_at ?? confirmedAt,
    blockNumber,
    gasUsed,
  }

  return NextResponse.json(response, { status: 200 })
}

async function parseStatusRequest(req: Request): Promise<ParseResult> {
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

  let parsedWalletAddress: EvmAddress | undefined

  if (walletAddress !== undefined) {
    if (typeof walletAddress !== "string" || !isAddress(walletAddress)) {
      errors.push("walletAddress must be a valid EVM address when provided.")
    } else {
      parsedWalletAddress = getAddress(walletAddress) as EvmAddress
    }
  }

  let parsedChainId: SupportedChainId | undefined

  if (chainId !== undefined) {
    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      errors.push(`chainId must be Base Sepolia ${BASE_SEPOLIA_CHAIN_ID}.`)
    } else {
      parsedChainId = BASE_SEPOLIA_CHAIN_ID
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      status: 400,
      reason: "Status request validation failed.",
      errors,
    }
  }

  return {
    ok: true,
    data: {
      executionId: executionId as string,
      txHash: normalizeHex(txHash as string) as EvmAddress,
      walletAddress: parsedWalletAddress,
      chainId: parsedChainId,
    },
  }
}

function validateExecutionRow(row: TradeExecutionRow, request: StatusRequest): string | null {
  if (row.chain_id !== BASE_SEPOLIA_CHAIN_ID) return "Execution row is not for Base Sepolia."
  if (request.chainId !== undefined && row.chain_id !== request.chainId) return "Requested chainId does not match execution row."
  if (!row.tx_hash) return "Execution row does not have a submitted tx_hash."
  if (normalizeHex(row.tx_hash) !== normalizeHex(request.txHash)) return "Requested txHash does not match execution row tx_hash."
  if (request.walletAddress && getAddress(row.wallet_address) !== request.walletAddress) return "Requested walletAddress does not match execution row."
  return null
}

function verifyOnchainTransaction(params: {
  execution: TradeExecutionRow
  request: StatusRequest
  receipt: Awaited<ReturnType<ReturnType<typeof createBaseSepoliaClient>["getTransactionReceipt"]>
  transaction: Awaited<ReturnType<ReturnType<typeof createBaseSepoliaClient>["getTransaction"]>
}): string | null {
  const { execution, request, receipt, transaction } = params

  if (normalizeHex(receipt.transactionHash) !== normalizeHex(request.txHash)) return "Receipt transactionHash does not match requested txHash."
  if (normalizeHex(transaction.hash) !== normalizeHex(request.txHash)) return "Transaction hash does not match requested txHash."
  if (getAddress(receipt.from) !== getAddress(execution.wallet_address)) return "Receipt sender does not match prepared wallet address."
  if (getAddress(transaction.from) !== getAddress(execution.wallet_address)) return "Transaction sender does not match prepared wallet address."
  if (transaction.chainId !== undefined && transaction.chainId !== BASE_SEPOLIA_CHAIN_ID) return "Transaction chainId does not match Base Sepolia."
  if (execution.calldata && normalizeHex(transaction.input) !== normalizeHex(execution.calldata)) return "Transaction calldata does not match prepared calldata."
  if (receipt.status !== "success" && receipt.status !== "reverted") return `Unexpected receipt status: ${receipt.status}.`

  return null
}

function createBaseSepoliaClient() {
  const rpcUrl =
    process.env.BASE_RPC_URL ??
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ??
    "https://sepolia.base.org"

  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  })
}

async function getReceiptSafely(
  publicClient: ReturnType<typeof createBaseSepoliaClient>,
  txHash: EvmAddress
) {
  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as Hash,
    })
    return { found: true as const, receipt }
  } catch {
    return { found: false as const }
  }
}

async function getTransactionSafely(
  publicClient: ReturnType<typeof createBaseSepoliaClient>,
  txHash: EvmAddress
) {
  try {
    const transaction = await publicClient.getTransaction({
      hash: txHash as Hash,
    })
    return { found: true as const, transaction }
  } catch {
    return { found: false as const }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeHex(value: string | null | undefined) {
  return value?.toLowerCase() ?? null
}
