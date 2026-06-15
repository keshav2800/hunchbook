import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopNav } from "@/components/app-shell/top-nav";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://hunchbook.tech"),
  title: "Hunchbook",
  description: "Prediction markets and liquidity vault on Sui / DeepBook",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>
          <TooltipProvider>
            <TopNav />
            {/* Inner dashboard layer: one frosted panel floating on the
                gradient world; all page cards live inside it. */}
            <main className="mx-auto w-full max-w-[1440px] px-4 py-4 md:px-6">
              <div className="rounded-2xl bg-background/35 p-4 ring-1 ring-white/10 backdrop-blur-xl md:p-6">
                {children}
              </div>
            </main>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
