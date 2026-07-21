import type { NextConfig } from "next";

// Webflow provides these routing values while building the deployment. They
// are public URLs/paths, so inlining them is safe and makes them available to
// the OpenNext server bundle even though they are not ordinary Worker env
// bindings at request time.
const webflowAssetsPrefix = process.env.ASSETS_PREFIX ?? "";
const rawBasePath = process.env.BASE_URL ?? "";
const webflowBasePath = rawBasePath === "/" ? "" : rawBasePath.replace(/\/$/, "");

const nextConfig: NextConfig = {
  basePath: webflowBasePath,
  assetPrefix: webflowAssetsPrefix || webflowBasePath || undefined,
  env: {
    ASSETS_PREFIX: webflowAssetsPrefix,
    BASE_URL: webflowBasePath,
  },
  // Pin the workspace root to this project. The parent directory contains an
  // unrelated package-lock.json, which otherwise causes Next to mis-infer the root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
