import type { Metadata } from "next";
import LenisProvider from "@/components/LenisProvider";
import SignalProvider from "@/components/signal/SignalProvider";
import ToastProvider from "@/components/ToastProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Corpo Mailer",
  description: "The sponsor desk for brAInwave",
};

const FONTS =
  "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>
        <SignalProvider>
          <LenisProvider>
            <ToastProvider>{children}</ToastProvider>
          </LenisProvider>
        </SignalProvider>
      </body>
    </html>
  );
}
