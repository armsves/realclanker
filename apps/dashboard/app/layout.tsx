import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RealClanker",
  description: "Human-backed agent ticketing. World ID proves the human, ENS v2 names the agent, Sui settles the ticket.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,520;9..144,680&family=Geist:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
