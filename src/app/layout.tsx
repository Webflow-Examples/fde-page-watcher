import type { Metadata } from "next";
import "./globals.css";

const title = "Page Watch · Brand Studio";
const description = "Nightly Lighthouse and agent-readiness monitoring for active pages.";

export const metadata: Metadata = {
  metadataBase: new URL("https://page-watcher.wf.app"),
  title,
  description,
  applicationName: "Page Watch",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/webflow-social.png", type: "image/png", sizes: "1080x1080" }],
    shortcut: ["/webflow-social.png"],
    apple: [{ url: "/webflow-social.png", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Page Watch",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title,
    description,
    images: [
      {
        url: "/webflow-social.png",
        width: 1080,
        height: 1080,
        alt: "Webflow logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: ["/webflow-social.png"],
  },
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
