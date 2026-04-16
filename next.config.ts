import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    '*.lvh.me:3000',
    'lvh.me:3000',
    'localhost:3000',
    '127.0.0.1:3000'
  ],
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/_next/webpack-hmr",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        source: "/(.*?)\\.(png|jpg|jpeg|gif|svg|ico|css|js)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
  // Keep Turbopack rooted in this workspace so parent lockfiles do not affect builds.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
