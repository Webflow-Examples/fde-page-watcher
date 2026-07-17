import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. The parent directory contains an
  // unrelated package-lock.json, which otherwise causes Next to mis-infer the root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
