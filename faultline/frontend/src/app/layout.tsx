import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FaultLine",
  description: "Agentic risk pricing engine for AI agent deployments",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
