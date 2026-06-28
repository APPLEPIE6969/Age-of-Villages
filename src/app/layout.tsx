import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Age of Villages — Browser RTS",
  description: "A fully playable Age of Empires-style real-time strategy game in the browser. Built with Three.js + Next.js.",
  keywords: ["RTS", "Age of Empires", "Three.js", "Next.js", "strategy game", "browser game"],
  authors: [{ name: "APPLEPIE6969" }],
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    title: "Age of Villages — Browser RTS",
    description: "Age of Empires-style RTS built with Three.js + Next.js",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Age of Villages",
    description: "Age of Empires-style RTS built with Three.js + Next.js",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
