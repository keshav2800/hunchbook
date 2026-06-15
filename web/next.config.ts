import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @hunchbook/shared ships raw TS source (exports ./src/index.ts)
  transpilePackages: ["@hunchbook/shared"],
  // Native module — must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
