"use client"

import { useAccount, useConnect, useDisconnect } from "wagmi"

export function ConnectWallet() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount()
  const { connect, connectors, error } = useConnect()
  const { disconnect } = useDisconnect()

  if (isReconnecting) {
    return <p className="text-sm text-gray-400">Reconnecting wallet...</p>
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col gap-2">
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            type="button"
            onClick={() => connect({ connector })}
            disabled={isConnecting}
            className="rounded border border-gray-700 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isConnecting ? "Connecting..." : `Connect ${connector.name}`}
          </button>
        ))}

        {error && (
          <p className="text-sm text-red-400">
            {error.message}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-sm">
        {address?.slice(0, 6)}...{address?.slice(-4)}
      </span>

      <button
        type="button"
        onClick={() => disconnect()}
        className="rounded border border-gray-700 px-4 py-2 text-sm"
      >
        Disconnect
      </button>
    </div>
  )
}
