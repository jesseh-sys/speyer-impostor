import type { Metadata, Viewport } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";

const vt323 = VT323({ weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SPEYER AFTER HOURS",
  description: "A text-adventure social deduction game",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AFTER HOURS",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0a",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${vt323.className} terminal-flicker`}>
        <div className="scanlines" />
        <div className="vignette" />
        {children}
      </body>
    </html>
  );
}
