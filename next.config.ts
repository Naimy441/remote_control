import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["*.*.*.*", "**.ts.net", "*.local"],
};

export default nextConfig;
