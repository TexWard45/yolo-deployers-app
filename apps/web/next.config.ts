import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@shared/types", "@shared/database", "@shared/rest", "@shared/env"],
  serverExternalPackages: ["@temporalio/client"],
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
