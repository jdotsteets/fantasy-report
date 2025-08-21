import type { NextConfig } from "next";

const nextConfig: NextConfig = {
   images: {
    remotePatterns: [
      // Hero fallback
      { protocol: "https", hostname: "images.unsplash.com" },

      // If you’ll show thumbs from publishers later, add them here as needed:
      // { protocol: "https", hostname: "s.yimg.com" },            // Yahoo
      // { protocol: "https", hostname: "static.www.nfl.com" },    // NFL
      // { protocol: "https", hostname: "cdn.fantasypros.com" },   // FantasyPros (example)
      // ...
    ],
  },
  /* config options here */
};

export default nextConfig;
