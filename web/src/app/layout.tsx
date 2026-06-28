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

const SITE_TITLE = "Hunchbook";
const SITE_DESC = "Prediction markets and liquidity vault on Sui / DeepBook";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESC,
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_TITLE,
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [
      {
        url: "/og.png", // 1200x630 (1.91:1) — served from public/, resolved against metadataBase
        width: 1200,
        height: 630,
        alt: "Hunchbook dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
    images: ["/og.png"],
  },
};

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_TITLE,
  url: SITE_URL,
  logo: `${SITE_URL}/hunchbook.png`,
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(orgJsonLd).replace(/</g, "\\u003c"),
          }}
        />
        <Providers>
          <TooltipProvider>
            <TopNav />
            {/* Inner dashboard layer: one frosted panel floating on the
                gradient world; all page cards live inside it. */}
            <main className="mx-auto w-full max-w-[1440px] px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:px-6 lg:pb-4">
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
