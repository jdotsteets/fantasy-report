// next.config.ts
import type { NextConfig } from "next";

module.exports = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.sanity.io' },
      { protocol: 'https', hostname: 'images2.minutemediacdn.com' }, // example other CDNs you see
      { protocol: 'https', hostname: 'static.www.nfl.com' },         // add the ones you use
      // ...do NOT include */_next/image or masslive resizer; we skip those
    ],
  },
};

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 1 day
    dangerouslyAllowSVG: false,

    // Keep this aligned with your app’s broader CSP (this only covers Next <Image> requests)
    contentSecurityPolicy:
      "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src * data: blob: https: http:; media-src 'none'; connect-src 'self'",

    // ⚠️ If you want to be stricter, remove the broad ** catch-alls and rely on the specific patterns below.
    remotePatterns: [
      // Your storage
      { protocol: "https", hostname: "jziinxyvfngxvkjtltqp.supabase.co", pathname: "/storage/v1/object/public/**" },

      // (Optional) Broad allow — comment these out if you prefer strict whitelisting
      { protocol: "https", hostname: "**" },
      { protocol: "http",  hostname: "**" },

      // WordPress / Jetpack CDN
      { protocol: "https", hostname: "i*.wp.com", pathname: "/**" },
      { protocol: "http",  hostname: "i*.wp.com", pathname: "/**" },

      // Major publishers/CDNs you use frequently
      { protocol: "https", hostname: "*.espncdn.com", pathname: "/**" },
      { protocol: "https", hostname: "*.nbcsports.com", pathname: "/**" },
      { protocol: "https", hostname: "*.nbcsportsbayarea.com", pathname: "/**" },
      { protocol: "https", hostname: "*.nbcsportsboston.com", pathname: "/**" },
      { protocol: "https", hostname: "*.nbcsportsphiladelphia.com", pathname: "/**" },

      { protocol: "https", hostname: "*.fantasypros.com", pathname: "/**" },       // e.g. cdn.fantasypros.com
      { protocol: "https", hostname: "*.yimg.com", pathname: "/**" },              // Yahoo
      { protocol: "https", hostname: "*.zenfs.com", pathname: "/**" },             // Yahoo media
      { protocol: "https", hostname: "*.usatoday.com", pathname: "/**" },          // e.g. soonerswire.usatoday.com
      { protocol: "https", hostname: "*.theathletic.com", pathname: "/**" },
      { protocol: "https", hostname: "*.rotoballer.com", pathname: "/**" },
      { protocol: "https", hostname: "*.razzball.com", pathname: "/**" },
      { protocol: "https", hostname: "*.sharpfootballanalysis.com", pathname: "/**" },
      { protocol: "https", hostname: "*.pff.com", pathname: "/**" },               // Pro Football Focus
      { protocol: "https", hostname: "*.sportingnews.com", pathname: "/**" },      // e.g. library.sportingnews.com

      // CBS images
      { protocol: "https", hostname: "sportshub.cbsistatic.com", pathname: "/**" },

      // Generic CDNs you’re likely to encounter
      { protocol: "https", hostname: "*.cloudfront.net", pathname: "/**" },
      { protocol: "https", hostname: "*.imgix.net", pathname: "/**" },
      { protocol: "https", hostname: "*.contentstack.io", pathname: "/**" },

      // Fallbacks
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
