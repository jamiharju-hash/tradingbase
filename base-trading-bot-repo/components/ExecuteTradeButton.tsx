"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  useAccount,
  useCallsStatus,
  useChainId,
  useSendCalls,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWalletClient,
} from "wagmi"
import { baseSepolia } from "wagmi/chains"
import type { Hash } from "viem"
import type {
  EvmAddress,
  PreparedTradeResponse,
  TradeSignal,
} from "@/lib/trading/types"
import { useWalletCapabilities } from "@/hooks/useWalletCapabilities"

type ExecuteTradeButtonProps = {
  symbol?: string
  signal?: TradeSignal
  className?: string
}

type ExecutionPhase =
  | "idle"
  | "preparing"
  | "prepared"
  | "switching_chain"
  | "awaiting_signature"
  | "batch_submitted"
  | "waiting_for_batch_hash"
  | "submitted"
  | "confirming"
  | "backend_verifying"
  | "confirmed"
  | "failed"

type SubmitResponse =
  | {
      submitted: true
      executionId: string
      txHash: Hash
      status: "SUBMITTED"
      submittedAt: string
      idempotent?: boolean
    }
  | {
      submitted: false
      reason: string
      errors?: string[]
    }

type StatusResponse =
  | {
      updated: true
      executionId: string
      txHash: Hash
      status: "CONFIRMED" | "FAILED"
      confirmedAt: string
      blockNumber: string
      gasUsed: string
      idempotent?: boolean
    }
  | {
      updated: false
      executionId?: string
      txHash?: Hash
      status?: "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "CANCELLED" | "PENDING"
      reason: string
      errors?: string[]
    }

const DEFAULT_SYMBOL = "WETH"
const DEFAULT_SIGNAL: TradeSignal = "BUY_SMALL"
const TARGET_CHAIN_ID = baseSepolia.id
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/

export function ExecuteTradeButton({
  symbol = DEFAULT_SYMBOL,
  signal = DEFAULT_SIGNAL,
  className,
}: ExecuteTradeButtonProps) {
  const { address, isConnected } = useAccount()
  const activeChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { data: walletClient } = useWalletClient()

  const {
    supportsBatching,
    supportsPaymaster,
    atomicStatus,
    isLoading: isCapabilityLoading,
    errorMessage: capabilityError,
  } = useWalletCapabilities(TARGET_CHAIN_ID)

  const {
    sendCallsAsync,
    error: sendCallsError,
  } = useSendCalls()

  const [phase, setPhase] = useState<ExecutionPhase>("idle")
  const [preparedTrade, setPreparedTrade] =
    useState<Extract<PreparedTradeResponse, { executable: true }> | null>(null)

  const [batchCallId, setBatchCallId] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hash | null>(null)
  const [submitResponse, setSubmitResponse] = useState<SubmitResponse | null>(null)
  const [statusResponse, setStatusResponse] = useState<StatusResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const submitLoggedRef = useRef(false)
  const statusCheckedRef = useRef(false)

  const {
    data: callsStatus,
    error: callsStatusError,
    isLoading: isCallsStatusLoading,
  } = useCallsStatus({
    id: batchCallId ?? undefined,
    query: {
      enabled: Boolean(batchCallId),
      refetchInterval: txHash ? false : 2_000,
    },
  })

  const {
    data: receipt,
    isLoading: isReceiptLoading,
    isSuccess: isReceiptSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: Boolean(txHash),
    },
  })

  const isBusy = useMemo(() => {
    return [
      "preparing",
      "switching_chain",
      "awaiting_signature",
      "batch_submitted",
      "waiting_for_batch_hash",
      "submitted",
      "confirming",
      "backend_verifying",
    ].includes(phase)
  }, [phase])

  const canPrepare = Boolean(isConnected && address && !isBusy)

  useEffect(() => {
    if (!callsStatus || txHash) return

    const extractedHash = extractTransactionHashFromCallsStatus(callsStatus)

    if (!extractedHash) {
      if (batchCallId && phase === "batch_submitted") {
        setPhase("waiting_for_batch_hash")
      }

      return
    }

    setTxHash(extractedHash)
    setPhase("submitted")
  }, [callsStatus, txHash, batchCallId, phase])

  useEffect(() => {
    if (!preparedTrade || !txHash || !address || submitLoggedRef.current) return

    submitLoggedRef.current = true

    void submitTransactionHash({
      executionId: preparedTrade.executionId,
      txHash,
      walletAddress: address,
      chainId: preparedTrade.chainId,
    })
  }, [preparedTrade, txHash, address])

  useEffect(() => {
    if (!preparedTrade || !txHash || !isReceiptSuccess || statusCheckedRef.current) {
      return
    }

    statusCheckedRef.current = true
    setPhase("backend_verifying")

    void verifyBackendStatus({
      executionId: preparedTrade.executionId,
      txHash,
      walletAddress: address,
      chainId: preparedTrade.chainId,
    })
  }, [preparedTrade, txHash, isReceiptSuccess, address])

  useEffect(() => {
    if (isReceiptLoading && txHash) {
      setPhase("confirming")
    }
  }, [isReceiptLoading, txHash])

  useEffect(() => {
    const error =
      sendCallsError?.message ||
      callsStatusError?.message ||
      receiptError?.message ||
      capabilityError

    if (!error) return

    setErrorMessage(error)
    setPhase("failed")
  }, [sendCallsError, callsStatusError, receiptError, capabilityError])

  async function prepareTrade() {
    if (!address) {
      setErrorMessage("Wallet is not connected.")
      setPhase("failed")
      return
    }

    resetExecutionState()
    setPhase("preparing")

    try {
      const response = await fetch("/api/trading/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol,
          signal,
          walletAddress: address,
          chainId: TARGET_CHAIN_ID,
        }),
      })

      const json = (await response.json()) as PreparedTradeResponse

      if (!response.ok || !json.executable) {
        const reason =
          !json.executable && json.reason
            ? json.reason
            : "Trade preparation rejected."

        const details =
          !json.executable && json.errors?.length
            ? ` ${json.errors.join(" ")}`
            : ""

        throw new Error(`${reason}${details}`)
      }

      setPreparedTrade(json)
      setPhase("prepared")
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unknown prepare error."
      )
      setPhase("failed")
    }
  }

  async function executePreparedTrade() {
    if (!preparedTrade) {
      setErrorMessage("No prepared trade available.")
      setPhase("failed")
      return
    }

    if (!address) {
      setErrorMessage("Wallet is not connected.")
      setPhase("failed")
      return
    }

    setErrorMessage(null)

    try {
      if (activeChainId !== preparedTrade.chainId) {
        setPhase("switching_chain")

        await switchChainAsync({
          chainId: preparedTrade.chainId,
        })
      }

      setPhase("awaiting_signature")

      if (supportsBatching) {
        await executeSmartWalletPath(preparedTrade)
        return
      }

      await executeEoaPath(preparedTrade)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unknown execution error."
      )
      setPhase("failed")
    }
  }

  async function executeEoaPath(
    trade: Extract<PreparedTradeResponse, { executable: true }>
  ) {
    if (!walletClient) {
      throw new Error("Wallet client is not available.")
    }

    const hash = await walletClient.sendTransaction({
      chain: baseSepolia,
      to: trade.to,
      data: trade.data,
      value: BigInt(trade.value),
    })

    setTxHash(hash)
    setPhase("submitted")
  }

  async function executeSmartWalletPath(
    trade: Extract<PreparedTradeResponse, { executable: true }>
  ) {
    const result = await sendCallsAsync({
      chainId: trade.chainId,
      calls: [
        {
          to: trade.to,
          data: trade.data,
          value: BigInt(trade.value),
        },
      ],
    })

    const callId = extractCallId(result)

    if (!callId) {
      throw new Error("sendCalls succeeded but did not return a callId.")
    }

    setBatchCallId(callId)
    setPhase("batch_submitted")
  }

  async function submitTransactionHash(params: {
    executionId: string
    txHash: Hash
    walletAddress: EvmAddress
    chainId: number
  }) {
    try {
      const response = await fetch("/api/trading/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      })

      const json = (await response.json()) as SubmitResponse

      setSubmitResponse(json)

      if (!response.ok || !json.submitted) {
        const reason =
          !json.submitted
            ? json.reason
            : "Backend submit logging failed."

        const details =
          !json.submitted && json.errors?.length
            ? ` ${json.errors.join(" ")}`
            : ""

        throw new Error(`${reason}${details}`)
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Transaction submitted, but /submit logging failed."
      )
      setPhase("failed")
    }
  }

  async function verifyBackendStatus(params: {
    executionId: string
    txHash: Hash
    walletAddress?: EvmAddress
    chainId: number
  }) {
    try {
      const response = await fetch("/api/trading/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      })

      const json = (await response.json()) as StatusResponse

      setStatusResponse(json)

      if (!response.ok || !json.updated) {
        const reason =
          !json.updated
            ? json.reason
            : "Backend status verification failed."

        const details =
          !json.updated && json.errors?.length
            ? ` ${json.errors.join(" ")}`
            : ""

        throw new Error(`${reason}${details}`)
      }

      setPhase(json.status === "CONFIRMED" ? "confirmed" : "failed")
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Backend status verification failed."
      )
      setPhase("failed")
    }
  }

  function resetExecutionState() {
    submitLoggedRef.current = false
    statusCheckedRef.current = false

    setPreparedTrade(null)
    setBatchCallId(null)
    setTxHash(null)
    setSubmitResponse(null)
    setStatusResponse(null)
    setErrorMessage(null)
  }

  if (!isConnected) {
    return (
      <div className={className}>
        <p className="text-sm text-gray-400">
          Connect wallet before preparing a trade.
        </p>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-4 rounded border border-gray-800 bg-neutral-950 p-4">
        <div>
          <p className="text-sm text-gray-400">Execution flow</p>

          <div className="mt-2 grid gap-1 text-sm">
            <p><span className="font-medium">Symbol:</span> {symbol}</p>
            <p><span className="font-medium">Signal:</span> {signal}</p>
            <p><span className="font-medium">Network:</span> Base Sepolia</p>
            <p>
              <span className="font-medium">Wallet:</span>{" "}
              <span className="font-mono">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
            </p>
            <p>
              <span className="font-medium">Execution path:</span>{" "}
              {isCapabilityLoading
                ? "checking wallet capabilities..."
                : supportsBatching
                  ? "smart wallet batch path"
                  : "EOA/raw transaction path"}
            </p>
            <p><span className="font-medium">EIP-5792 atomic:</span> {atomicStatus ?? "not reported"}</p>
            <p><span className="font-medium">Paymaster:</span> {supportsPaymaster ? "supported" : "not supported"}</p>
          </div>
        </div>

        {preparedTrade && (
          <div className="rounded border border-gray-800 p-3 text-sm">
            <p><span className="font-medium">Execution ID:</span>{" "}<span className="font-mono">{preparedTrade.executionId}</span></p>
            <p><span className="font-medium">Target:</span>{" "}<span className="font-mono">{preparedTrade.to}</span></p>
            <p><span className="font-medium">Max slippage:</span> {preparedTrade.risk.maxSlippageBps} bps</p>
            <p><span className="font-medium">Max position:</span> ${preparedTrade.risk.maxPositionUsd}</p>
            <p><span className="font-medium">Mode:</span> {preparedTrade.risk.mode}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={prepareTrade}
            disabled={!canPrepare}
            className="rounded border border-gray-700 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "preparing" ? "Preparing..." : "Prepare trade"}
          </button>

          <button
            type="button"
            onClick={executePreparedTrade}
            disabled={!preparedTrade || isBusy}
            className="rounded border border-gray-700 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {getExecutionButtonLabel(phase)}
          </button>
        </div>

        <div className="rounded border border-gray-800 p-3 text-sm">
          <p><span className="font-medium">Status:</span> {getStatusLabel(phase)}</p>

          {batchCallId && (
            <p className="mt-1">
              <span className="font-medium">Call ID:</span>{" "}
              <span className="font-mono">{batchCallId}</span>
            </p>
          )}

          {isCallsStatusLoading && batchCallId && (
            <p className="mt-1 text-gray-400">
              Waiting for smart wallet call status...
            </p>
          )}

          {txHash && (
            <p className="mt-1">
              <span className="font-medium">Tx:</span>{" "}
              <a
                href={`https://sepolia.basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline"
              >
                {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </a>
            </p>
          )}

          {submitResponse?.submitted && (
            <p className="mt-1">
              <span className="font-medium">DB:</span> SUBMITTED at{" "}
              {submitResponse.submittedAt}
            </p>
          )}

          {receipt?.status && (
            <p className="mt-1">
              <span className="font-medium">Local receipt:</span>{" "}
              {receipt.status}
            </p>
          )}

          {statusResponse?.updated && (
            <p className="mt-1">
              <span className="font-medium">Backend verified:</span>{" "}
              {statusResponse.status}
            </p>
          )}

          {statusResponse?.updated && (
            <p className="mt-1">
              <span className="font-medium">Block:</span>{" "}
              {statusResponse.blockNumber}
            </p>
          )}
        </div>

        {errorMessage && (
          <p className="text-sm text-red-400">{errorMessage}</p>
        )}
      </div>
    </div>
  )
}

function extractCallId(result: unknown): string | null {
  if (typeof result === "string" && result.length > 0) {
    return result
  }

  if (!isRecord(result)) {
    return null
  }

  const id = result.id
  return typeof id === "string" && id.length > 0 ? id : null
}

function extractTransactionHashFromCallsStatus(value: unknown): Hash | null {
  if (!isRecord(value)) return null

  const directHash = value.transactionHash
  if (typeof directHash === "string" && isValidTxHash(directHash)) {
    return directHash as Hash
  }

  const receipts = value.receipts
  if (Array.isArray(receipts)) {
    for (const receipt of receipts) {
      if (!isRecord(receipt)) continue
      const transactionHash = receipt.transactionHash
      if (typeof transactionHash === "string" && isValidTxHash(transactionHash)) {
        return transactionHash as Hash
      }
    }
  }

  return null
}

function isValidTxHash(value: string) {
  return TX_HASH_REGEX.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getStatusLabel(phase: ExecutionPhase) {
  switch (phase) {
    case "idle": return "Idle. No trade prepared."
    case "preparing": return "Backend is preparing trade and enforcing risk limits."
    case "prepared": return "Trade prepared. Awaiting wallet execution."
    case "switching_chain": return "Switching wallet to Base Sepolia."
    case "awaiting_signature": return "Waiting for wallet signature."
    case "batch_submitted": return "Smart wallet call submitted. Waiting for call status."
    case "waiting_for_batch_hash": return "Waiting for smart wallet transaction hash."
    case "submitted": return "Transaction hash received and being logged."
    case "confirming": return "Transaction submitted. Waiting for local receipt."
    case "backend_verifying": return "Backend is verifying receipt directly from Base Sepolia."
    case "confirmed": return "Transaction confirmed and backend verified."
    case "failed": return "Execution failed or was rejected."
  }
}

function getExecutionButtonLabel(phase: ExecutionPhase) {
  switch (phase) {
    case "switching_chain": return "Switching network..."
    case "awaiting_signature": return "Confirm in wallet..."
    case "batch_submitted":
    case "waiting_for_batch_hash": return "Waiting for tx hash..."
    case "submitted":
    case "confirming": return "Confirming..."
    case "backend_verifying": return "Verifying..."
    case "confirmed": return "Confirmed"
    default: return "Execute trade"
  }
}
