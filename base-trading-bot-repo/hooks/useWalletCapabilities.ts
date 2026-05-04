"use client"

import { useMemo } from "react"
import { useAccount, useCapabilities } from "wagmi"
import { baseSepolia } from "wagmi/chains"
import type { SupportedChainId } from "@/lib/trading/types"

type WalletCapabilitiesResult = {
  chainId: SupportedChainId
  isConnected: boolean
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  supportsBatching: boolean
  supportsPaymaster: boolean
  atomicStatus: string | null
  rawCapabilities: unknown
}

export function useWalletCapabilities(
  chainId: SupportedChainId = baseSepolia.id
): WalletCapabilitiesResult {
  const { address, isConnected } = useAccount()

  const {
    data: capabilities,
    isLoading,
    isError,
    error,
  } = useCapabilities({
    account: address,
    query: {
      enabled: Boolean(address && isConnected),
    },
  })

  const chainCapabilities = capabilities?.[chainId]

  const atomicStatus = useMemo(() => {
    const atomic = chainCapabilities?.atomic

    if (!atomic || typeof atomic !== "object") {
      return null
    }

    const status = "status" in atomic ? atomic.status : null

    return typeof status === "string" ? status : null
  }, [chainCapabilities])

  const supportsBatching = useMemo(() => {
    return atomicStatus === "ready" || atomicStatus === "supported"
  }, [atomicStatus])

  const supportsPaymaster = useMemo(() => {
    const paymasterService = chainCapabilities?.paymasterService

    if (!paymasterService || typeof paymasterService !== "object") {
      return false
    }

    const supported =
      "supported" in paymasterService ? paymasterService.supported : false

    return supported === true
  }, [chainCapabilities])

  return {
    chainId,
    isConnected,
    isLoading,
    isError,
    errorMessage: error instanceof Error ? error.message : null,
    supportsBatching,
    supportsPaymaster,
    atomicStatus,
    rawCapabilities: chainCapabilities ?? null,
  }
}
