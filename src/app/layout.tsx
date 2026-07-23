import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Page Watch · Brand Studio",
  description: "Nightly Lighthouse and agent-readiness monitoring for active pages.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
