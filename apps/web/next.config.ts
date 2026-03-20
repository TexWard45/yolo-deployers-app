import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@shared/types", "@shared/database", "@shared/rest", "@shared/env"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
