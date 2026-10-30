import type { Metadata } from "next";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SessionProvider } from "@/lib/session";

export const metadata: Metadata = {
  title: { default: "FireComply", template: "%s · FireComply" },
  description: "Fire & security compliance: certificates, assets, defects, quotes and invoices (BS 5839, BS 5266, BAFE, NSI).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen font-sans">
        <ConvexClientProvider>
          <SessionProvider>{children}</SessionProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
