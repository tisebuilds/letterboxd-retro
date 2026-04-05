import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default true in 15.5+; breaks some dev setups (SegmentViewNode client manifest → webpack runtime crash).
    devtoolSegmentExplorer: false,
  },
};

export default nextConfig;
