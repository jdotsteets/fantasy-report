// next-sitemap.config.js  (ESM)
const siteUrl = process.env.SITE_URL ?? "https://your-domain.com";

/** @type {import('next-sitemap').IConfig} */
const config = {
  siteUrl,
  generateRobotsTxt: true,
  outDir: "public",
  // optional:
  changefreq: "hourly",
  priority: 0.7,
  exclude: ["/api/*", "/admin/*"],
  robotsTxtOptions: {
    policies: [
      { userAgent: "*", allow: "/" },
      { userAgent: "*", disallow: ["/api", "/admin"] },
    ],
  },
};

export default config;
