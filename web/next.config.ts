import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @hunchbook/shared ships raw TS source (exports ./src/index.ts)
  transpilePackages: ["@hunchbook/shared"],
  // Prisma's query engine is a native binary — keep it out of the server bundle.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
