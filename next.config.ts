import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "https", hostname: "a.espncdn.com" },
      { protocol: "https", hostname: "a1.espncdn.com" },
      { protocol: "https", hostname: "a2.espncdn.com" },
      { protocol: "https", hostname: "a3.espncdn.com" },
      { protocol: "https", hostname: "a4.espncdn.com" },
      { protocol: "https", hostname: "cdn.profootballrumors.com" },
      { protocol: "https", hostname: "cdn.yourdomain.com" },
      { protocol: "https", hostname: "dynastyleaguefootball.com" },
      { protocol: "https", hostname: "football.razzball.com" },
      { protocol: "https", hostname: "ichef.bbci.co.uk" },
      { protocol: "https", hostname: "images.contentstack.io" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "media.nbcsportsbayarea.com" },
      { protocol: "https", hostname: "media.nbcsportsboston.com" },
      { protocol: "https", hostname: "media.nbcsportsphiladelphia.com" },
      { protocol: "https", hostname: "media.pff.com" },
      { protocol: "https", hostname: "media.zenfs.com" },
      { protocol: "https", hostname: "nbcsports.brightspotcdn.com" },
      { protocol: "https", hostname: "s.yimg.com" },
      { protocol: "https", hostname: "s26212.pcdn.co" },
      { protocol: "https", hostname: "sportshub.cbsistatic.com" },
      { protocol: "https", hostname: "www.4for4.com" },
      { protocol: "https", hostname: "www.facebook.com" },
      { protocol: "https", hostname: "www.google.com" },
      { protocol: "https", hostname: "www.rotoballer.com" },
      { protocol: "https", hostname: "www.sharpfootballanalysis.com" },
      { protocol: "https", hostname: "www.sportico.com" },
      { protocol: "https", hostname: "www.telegraph.co.uk" },
    ],
  },
};

export default nextConfig;
