import { http, createConfig, createStorage, cookieStorage } from "wagmi"
import { base, baseSepolia } from "wagmi/chains"
import { baseAccount, injected } from "wagmi/connectors"

export const config = createConfig({
  chains: [baseSepolia, base],
  connectors: [
    injected(),
    baseAccount({
      appName: "Base Trading Bot",
    }),
  ],
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  transports: {
    [baseSepolia.id]: http(
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"
    ),
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
  },
})

declare module "wagmi" {
  interface Register {
    config: typeof config
  }
}
