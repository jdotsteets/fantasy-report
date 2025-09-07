// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Avoid failing the build on lint warnings/errors in CI
    ignoreDuringBuilds: true,
  },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 1 day
    dangerouslyAllowSVG: false,

    // Applied only to the Next.js image optimizer fetches
    contentSecurityPolicy:
      "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src * data: blob: https: http:; media-src 'none'; connect-src 'self'",

    // IMPORTANT: Keep these specific. Wildcards like "**" are invalid.
    remotePatterns: [
      // Supabase storage
      {
        protocol: "https",
        hostname: "jziinxyvfngxvkjtltqp.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },

      // WordPress / Jetpack CDN
      { protocol: "https", hostname: "i0.wp.com", pathname: "/**" },
      { protocol: "https", hostname: "i1.wp.com", pathname: "/**" },
      { protocol: "https", hostname: "i2.wp.com", pathname: "/**" },
      // If you truly encounter http images from those (rare), keep these:
      { protocol: "http", hostname: "i0.wp.com", pathname: "/**" },
      { protocol: "http", hostname: "i1.wp.com", pathname: "/**" },
      { protocol: "http", hostname: "i2.wp.com", pathname: "/**" },

      // Rotoballer
      { protocol: "https", hostname: "rotoballer.com", pathname: "/wp-content/**" },
      { protocol: "https", hostname: "www.rotoballer.com", pathname: "/wp-content/**" },
      { protocol: "http", hostname: "rotoballer.com", pathname: "/wp-content/**" },
      { protocol: "http", hostname: "www.rotoballer.com", pathname: "/wp-content/**" },

      // Major sports sources/CDNs
      { protocol: "https", hostname: "s.yimg.com", pathname: "/**" },
      { protocol: "https", hostname: "media.zenfs.com", pathname: "/**" },
      { protocol: "https", hostname: "a.espncdn.com", pathname: "/**" },
      { protocol: "https", hostname: "a1.espncdn.com", pathname: "/**" },
      { protocol: "https", hostname: "a2.espncdn.com", pathname: "/**" },
      { protocol: "https", hostname: "a3.espncdn.com", pathname: "/**" },
      { protocol: "https", hostname: "a4.espncdn.com", pathname: "/**" },
      { protocol: "https", hostname: "sportshub.cbsistatic.com", pathname: "/**" },
      { protocol: "https", hostname: "nbcsports.brightspotcdn.com", pathname: "/**" },
      { protocol: "https", hostname: "media.nbcsportsbayarea.com", pathname: "/**" },
      { protocol: "https", hostname: "media.nbcsportsboston.com", pathname: "/**" },
      { protocol: "https", hostname: "media.nbcsportsphiladelphia.com", pathname: "/**" },
      { protocol: "https", hostname: "media.pff.com", pathname: "/**" },

      // Other CDNs you listed
      { protocol: "https", hostname: "images.contentstack.io", pathname: "/**" },
      { protocol: "https", hostname: "s26212.pcdn.co", pathname: "/**" },
      { protocol: "https", hostname: "cdn.profootballrumors.com", pathname: "/**" },

      // Your app domain (if you ever proxy/serve images yourself)
      { protocol: "https", hostname: "fantasy-report.vercel.app", pathname: "/**" },

      // Example generic CDNs (only keep if you truly use them)
      { protocol: "https", hostname: "your-bucket.s3.amazonaws.com", pathname: "/**" },
      { protocol: "https", hostname: "d1234abcd.cloudfront.net", pathname: "/**" },
      { protocol: "https", hostname: "assets.imgix.net", pathname: "/**" },

      // Fallback/stock
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },

      // Other publishers you mentioned (each needs a concrete hostname)
      { protocol: "https", hostname: "media.bleacherreport.com", pathname: "/**" },
      { protocol: "https", hostname: "rookiewire.usatoday.com", pathname: "/**" },
      { protocol: "https", hostname: "www.usatoday.com", pathname: "/**" },
      { protocol: "https", hostname: "theathletic.com", pathname: "/**" },
      { protocol: "https", hostname: "www.theathletic.com", pathname: "/**" },
      { protocol: "https", hostname: "www.razzball.com", pathname: "/**" },
      { protocol: "https", hostname: "www.sharpfootballanalysis.com", pathname: "/**" },
      { protocol: "https", hostname: "nbcsports.com", pathname: "/**" },
      { protocol: "https", hostname: "www.nbcsports.com", pathname: "/**" },
      { protocol: "https", hostname: "fantasypros.com", pathname: "/**" },
      { protocol: "https", hostname: "www.fantasypros.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
