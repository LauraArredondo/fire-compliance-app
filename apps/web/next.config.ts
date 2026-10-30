import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Workspace packages: Convex API refs (packages/backend) and shared roles/permissions (packages/shared).
  transpilePackages: ["@fire/backend", "@fire/shared"],
  turbopack: { root: path.join(__dirname, "../..") },
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
