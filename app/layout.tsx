import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import { AuthProvider } from "@/state/AuthProvider";
import { AllyProvider } from "@/state/AllyProvider";
import { SheetProvider } from "@/state/SheetProvider";
import { ManifestProvider } from "@/state/ManifestProvider";
import { ToastProvider } from "@/state/ToastProvider";
import { SheetHost } from "@/components/Sheet";
import { ToastHost } from "@/components/Toast";
import { AllyGate } from "@/components/AllyGate";
import { DebugPanel } from "@/debug/DebugPanel";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-instrument-sans",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ally",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${instrumentSerif.variable}`}>
      <body>
        <AuthProvider>
          <AllyProvider>
            <ManifestProvider>
              <SheetProvider>
                <ToastProvider>
                  <div id="app">
                    <AllyGate>{children}</AllyGate>
                    <DebugPanel />
                  </div>
                  <SheetHost />
                  <ToastHost />
                </ToastProvider>
              </SheetProvider>
            </ManifestProvider>
          </AllyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
