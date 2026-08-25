import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Page Watch · Brand Studio",
    short_name: "Page Watch",
    description: "Nightly Lighthouse and agent-readiness monitoring for active pages.",
    start_url: "/",
    display: "standalone",
    // The one place in src/ outside the globals.css token blocks that still
    // names a colour value, because a web app manifest is JSON read by the
    // browser's install UI — a CSS custom property cannot resolve here.
    //
    // Keep these two in step by hand with the light `:root` block:
    //   background_color  =  --surface-page       (neutral-50)
    //   theme_color       =  --action-primary-bg  (blue-600)
    background_color: "#f7f7f8",
    theme_color: "#146ef5",
    icons: [
      {
        src: "/webflow-social.png",
        sizes: "1080x1080",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/webflow-social.png",
        sizes: "1080x1080",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
