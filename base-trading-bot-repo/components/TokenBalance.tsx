"use client"

import { useEffect, useMemo } from "react"
import { erc20Abi, formatUnits } from "viem"
import {
  useAccount,
  useBlockNumber,
  useChainId,
  useReadContract,
  useSwitchChain,
} from "wagmi"
import { DEFAULT_ERC20_TOKEN } from "@/config/tokens"
import type { TokenConfig } from "@/lib/trading/types"

type TokenBalanceProps = {
  token?: TokenConfig
  className?: string
  refetchIntervalMs?: number
}

export function TokenBalance({
  token = DEFAULT_ERC20_TOKEN,
  className,
  refetchIntervalMs = 15_000,
}: TokenBalanceProps) {
  const { address, isConnected } = useAccount()
  const activeChainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const isWrongChain = isConnected && activeChainId !== token.chainId
  const queryEnabled = Boolean(isConnected && address && !isWrongChain)

  const balanceQuery = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: token.chainId,
    query: {
      enabled: queryEnabled,
      refetchInterval: refetchIntervalMs,
    },
  })

  const { data: blockNumber } = useBlockNumber({
    chainId: token.chainId,
    watch: queryEnabled,
  })

  useEffect(() => {
    if (!queryEnabled) return
    void balanceQuery.refetch()
  }, [blockNumber, queryEnabled, balanceQuery])

  const formattedBalance = useMemo(() => {
    if (typeof balanceQuery.data !== "bigint") return null
    return formatUnits(balanceQuery.data, token.decimals)
  }, [balanceQuery.data, token.decimals])

  if (!isConnected) {
    return (
      <div className={className}>
        <p className="text-sm text-gray-400">
          Connect wallet to view {token.symbol} balance.
        </p>
      </div>
    )
  }

  if (isWrongChain) {
    return (
      <div className={className}>
        <p className="text-sm text-gray-400">
          Switch network to view {token.symbol} balance.
        </p>

        <button
          type="button"
          onClick={() => switchChain({ chainId: token.chainId })}
          disabled={isSwitching}
          className="mt-2 rounded border border-gray-700 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSwitching ? "Switching..." : "Switch network"}
        </button>
      </div>
    )
  }

  if (balanceQuery.isLoading || balanceQuery.isPending) {
    return (
      <div className={className}>
        <p className="text-sm text-gray-400">
          Loading {token.symbol} balance...
        </p>
      </div>
    )
  }

  if (balanceQuery.isError && balanceQuery.data === undefined) {
    return (
      <div className={className}>
        <p className="text-sm text-red-400">
          Failed to load {token.symbol} balance: {balanceQuery.error.message}
        </p>
      </div>
    )
  }

  return (
    <div className={className}>
      <p className="text-sm text-gray-400">{token.name} balance</p>
      <p className="font-mono text-xl">
        {formattedBalance ?? "0"} {token.symbol}
      </p>

      {balanceQuery.isFetching && (
        <p className="text-xs text-gray-500">Updating...</p>
      )}
    </div>
  )
}
