import type { Metadata } from "next";
import "./globals.css";

const title = "Page Watch · Brand Studio";
const description = "Nightly Lighthouse and agent-readiness monitoring for active pages.";

export const metadata: Metadata = {
  metadataBase: new URL("https://page-watcher.webflow.io"),
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
    // `data-surface` selects the theme block in globals.css. `:root` carries
    // light and `[data-surface="dark"]` overrides it.
    //
    // Deliberately unset here: the server cannot know the reader's preference,
    // so the pre-paint script in (app)/layout.tsx sets it during parse, before
    // first paint. Hard-coding a value here would make that script a *change*
    // rather than an initialisation, which is what causes a visible flash.
    // suppressHydrationWarning covers exactly one attribute: the pre-paint
    // script sets `data-surface` before React hydrates, so the server HTML and
    // the client tree differ here by design.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
