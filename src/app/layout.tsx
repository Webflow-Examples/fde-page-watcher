import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Page Watch · Brand Studio",
  description: "Nightly Lighthouse & agent-readiness monitoring for priority Webflow.com pages.",
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
