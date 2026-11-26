import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Stock Market used to live at "/": keep old room links ("/?room=CODE") working. The query string carries over.
  async redirects() {
    return [{ source: "/", has: [{ type: "query", key: "room" }], destination: "/stock-market", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
