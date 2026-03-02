// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 1 day
    dangerouslyAllowSVG: false,

    // This applies to the Next image optimizer responses only.
    // Keep your app-level CSP (e.g., via headers) in sync as needed.
    contentSecurityPolicy:
      "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src * data: blob: https: http:; media-src 'none'; connect-src 'self'",

    // Use either domains OR remotePatterns. We’ll use remotePatterns.
    remotePatterns: [
      // Your storage
      {
        protocol: "https",
        hostname: "jziinxyvfngxvkjtltqp.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },

      // Broad allow (comment these out if you prefer a strict list)
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },

      // WordPress / Jetpack CDN
      { protocol: "https", hostname: "i*.wp.com", pathname: "/**" },
      { protocol: "http", hostname: "i*.wp.com", pathname: "/**" },

      // Big publishers/CDNs you’re using
      { protocol: "https", hostname: "*.espncdn.com", pathname: "/**" },
      { protocol: "https", hostname: "*.nbcsports.com", pathname: "/**" },
      { protocol: "https", hostname: "*.nbcsportsbayarea.com", pathname: "/**" },
      { protocol: "https", hostname: "*.nbcsportsboston.com", pathname: "/**" },
      { protocol: "https", hostname: "*.nbcsportsphiladelphia.com", pathname: "/**" },
      { protocol: "https", hostname: "*.fanduel.com", pathname: "/**" },

      { protocol: "https", hostname: "*.fantasypros.com", pathname: "/**" },
      { protocol: "https", hostname: "*.yimg.com", pathname: "/**" },
      { protocol: "https", hostname: "*.zenfs.com", pathname: "/**" },
      { protocol: "https", hostname: "*.usatoday.com", pathname: "/**" },
      { protocol: "https", hostname: "*.theathletic.com", pathname: "/**" },
      { protocol: "https", hostname: "*.rotoballer.com", pathname: "/**" },
      { protocol: "https", hostname: "*.razzball.com", pathname: "/**" },
      { protocol: "https", hostname: "*.sharpfootballanalysis.com", pathname: "/**" },
      { protocol: "https", hostname: "*.pff.com", pathname: "/**" },
      { protocol: "https", hostname: "*.sportingnews.com", pathname: "/**" },

      // NFL / CBS / generic
      { protocol: "https", hostname: "static.www.nfl.com", pathname: "/**" },
      { protocol: "https", hostname: "sportshub.cbsistatic.com", pathname: "/**" },

      // Generic CDNs
      { protocol: "https", hostname: "*.cloudfront.net", pathname: "/**" },
      { protocol: "https", hostname: "*.imgix.net", pathname: "/**" },
      { protocol: "https", hostname: "*.contentstack.io", pathname: "/**" },

      // Your earlier additions
      { protocol: "https", hostname: "cdn.sanity.io", pathname: "/**" },
      { protocol: "https", hostname: "images2.minutemediacdn.com", pathname: "/**" },

      // Fallbacks / examples
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
