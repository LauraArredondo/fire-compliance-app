import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The Convex API types/refs live in the workspace package packages/backend.
  transpilePackages: ["@fire/backend", "@fire/tokens"],
  turbopack: { root: path.join(__dirname, "../..") },
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
