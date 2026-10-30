import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/components/ThemeProvider";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "FireGrid", template: "%s · FireGrid" },
  description: "FireGrid — fire and security compliance: certificates, assets, defects, quotes and invoices (BS 5839, BS 5266, BAFE, NSI).",
  icons: {
    icon: [
      { url: "/brand/favicon-light.png", media: "(prefers-color-scheme: light)", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-dark.png", media: "(prefers-color-scheme: dark)", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-fg antialiased">
        <ThemeProvider>
          <ConvexClientProvider>
            <SessionProvider>{children}</SessionProvider>
          </ConvexClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
