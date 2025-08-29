import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
  formats: ["image/avif", "image/webp"],
  minimumCacheTTL: 60 * 60 * 24, // 1 day
  dangerouslyAllowSVG: false,

  // If you set a strict CSP elsewhere, keep img-src wide enough to fetch from these
  contentSecurityPolicy:
    "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src * data: blob: https: http:; media-src 'none'; connect-src 'self'",

  remotePatterns: [
    { protocol: "https", hostname: "jziinxyvfngxvkjtltqp.supabase.co", pathname: "/storage/v1/object/public/**", },
    { protocol: "https", hostname: "**" }, // broad, or lock down later
    { protocol: "http", hostname: "**" },  // if you truly have http sources
    // WordPress / Jetpack CDN (often used as redirect targets)
    { protocol: "https", hostname: "i0.wp.com", pathname: "/**" },
    { protocol: "https", hostname: "i1.wp.com", pathname: "/**" },
    { protocol: "https", hostname: "i2.wp.com", pathname: "/**" },
    { protocol: "http",  hostname: "i0.wp.com", pathname: "/**" },
    { protocol: "http",  hostname: "i1.wp.com", pathname: "/**" },
    { protocol: "http",  hostname: "i2.wp.com", pathname: "/**" },

    // Rotoballer (both apex and www, both protocols)
    { protocol: "https", hostname: "rotoballer.com", pathname: "/wp-content/**" },
    { protocol: "https", hostname: "www.rotoballer.com", pathname: "/wp-content/**" },
    { protocol: "http",  hostname: "rotoballer.com", pathname: "/wp-content/**" },
    { protocol: "http",  hostname: "www.rotoballer.com", pathname: "/wp-content/**" },
      { protocol: "https", hostname: "**.espncdn.com" },
      { protocol: "https", hostname: "**.nbcsports.com" },
      { protocol: "https", hostname: "**.fantasypros.com" },
      { protocol: "https", hostname: "s.yimg.com" },        // Yahoo images
      { protocol: "https", hostname: "media.bleacherreport.com" },
      { protocol: "https", hostname: "**.usatoday.com" },
      { protocol: "https", hostname: "**.rookiewire.usatoday.com" },
      { protocol: "https", hostname: "**.theathletic.com" },
      { protocol: "https", hostname: "**.rotoballer.com" },
      { protocol: "https", hostname: "**.razzball.com" },
      { protocol: "https", hostname: "**.sharpfootballanalysis.com" },

    // Yahoo / ESPN / CBS / NBC / PFF (common in your feed)
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

    // Other CDNs you already had
    { protocol: "https", hostname: "images.contentstack.io", pathname: "/**" },
    { protocol: "https", hostname: "s26212.pcdn.co", pathname: "/**" },
    { protocol: "https", hostname: "cdn.profootballrumors.com", pathname: "/**" },
      // If CDN redirects to your app domain (example)
      { protocol: "https", hostname: "fantasy-report.vercel.app" },
      // If CDN redirects to S3/CloudFront/Imgix/etc. (examples)
      { protocol: "https", hostname: "your-bucket.s3.amazonaws.com" },
      { protocol: "https", hostname: "d1234abcd.cloudfront.net" },
      { protocol: "https", hostname: "assets.imgix.net" },

    // Your fallback
    { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
  ],
},



};

export default nextConfig;


