import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ObraScope — Monitoreo de Obras Públicas",
  description:
    "Dashboard SaaS para municipalidades y gobiernos regionales del Perú. Monitorea PIM, devengado, avance físico y semáforos en tiempo real.",
  applicationName: "ObraScope",
  authors: [{ name: "ObraScope" }],
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-bg text-ink">{children}</body>
    </html>
  );
}
