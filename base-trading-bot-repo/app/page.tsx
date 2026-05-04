import { ConnectWallet } from "@/components/ConnectWallet"
import { ExecuteTradeButton } from "@/components/ExecuteTradeButton"
import { TokenBalance } from "@/components/TokenBalance"

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-8">
      <section className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-gray-500">
          Base Sepolia
        </p>
        <h1 className="text-3xl font-bold">Base Trading Bot</h1>
        <p className="max-w-2xl text-sm text-gray-400">
          Testnet-first wallet execution scaffold with backend risk validation,
          Supabase audit logging, EIP-5792 smart wallet support and backend
          receipt verification.
        </p>
      </section>

      <section className="rounded border border-gray-800 bg-neutral-950 p-4">
        <ConnectWallet />
      </section>

      <section className="rounded border border-gray-800 bg-neutral-950 p-4">
        <TokenBalance />
      </section>

      <ExecuteTradeButton symbol="WETH" signal="BUY_SMALL" />
    </main>
  )
}
