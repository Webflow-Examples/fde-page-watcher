import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Page Watch · Brand Studio",
    short_name: "Page Watch",
    description: "Nightly Lighthouse and agent-readiness monitoring for active pages.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0c",
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
