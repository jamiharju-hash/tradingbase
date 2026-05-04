import { Attribution } from "ox/erc8021"
import type { HexString } from "@/lib/trading/types"

const BUILDER_CODE_REGEX = /^bc_[a-zA-Z0-9_]+$/

export type BuilderCodeResult =
  | {
      enabled: true
      builderCode: string
      suffix: HexString
    }
  | {
      enabled: false
      builderCode: null
      suffix: null
      reason: string
    }

export function getBuilderCodeConfig(): BuilderCodeResult {
  const builderCode = process.env.BASE_BUILDER_CODE
  const requireBuilderCode = process.env.REQUIRE_BASE_BUILDER_CODE === "true"

  if (!builderCode) {
    if (requireBuilderCode) {
      throw new Error(
        "BASE_BUILDER_CODE is required because REQUIRE_BASE_BUILDER_CODE=true."
      )
    }

    return {
      enabled: false,
      builderCode: null,
      suffix: null,
      reason: "BASE_BUILDER_CODE is not configured.",
    }
  }

  if (!BUILDER_CODE_REGEX.test(builderCode)) {
    throw new Error(
      "BASE_BUILDER_CODE has invalid format. Expected format like bc_a1b2c3d4."
    )
  }

  const suffix = Attribution.toDataSuffix({
    codes: [builderCode],
  }) as HexString

  return {
    enabled: true,
    builderCode,
    suffix,
  }
}

export function appendBuilderCodeToCalldata(data: HexString): {
  calldata: HexString
  builderCodeApplied: boolean
  builderCode: string | null
} {
  const config = getBuilderCodeConfig()

  if (!config.enabled) {
    return {
      calldata: data,
      builderCodeApplied: false,
      builderCode: null,
    }
  }

  if (data === "0x") {
    return {
      calldata: config.suffix,
      builderCodeApplied: true,
      builderCode: config.builderCode,
    }
  }

  return {
    calldata: `${data}${config.suffix.slice(2)}` as HexString,
    builderCodeApplied: true,
    builderCode: config.builderCode,
  }
}
