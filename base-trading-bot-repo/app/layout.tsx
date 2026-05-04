import type { Metadata } from "next"
import "./globals.css"
import { Providers } from "@/app/providers"

export const metadata: Metadata = {
  title: "Base Trading Bot",
  description: "Base Sepolia trading execution scaffold"
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fi">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
