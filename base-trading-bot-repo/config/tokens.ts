import { baseSepolia } from "wagmi/chains"
import type { TokenConfig } from "@/lib/trading/types"

export const DEFAULT_ERC20_TOKEN: TokenConfig = {
  chainId: baseSepolia.id,
  address: "0x4200000000000000000000000000000000000006",
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
}

export const WATCHED_TOKENS: TokenConfig[] = [DEFAULT_ERC20_TOKEN]
