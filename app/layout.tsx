import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Remote",
  description: "Control this Mac from your phone over Tailscale.",
  applicationName: "Remote",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "Remote",
    statusBarStyle: "black",
  },
  formatDetection: { telephone: false },
  // Next only emits the generic mobile-web-app-capable tag; iOS reads this Apple one when deciding to extend the
  // page under the status bar and home indicator for a Home Screen app.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0e0f12",
  colorScheme: "dark",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body>{children}</body>
    </html>
  );
}
