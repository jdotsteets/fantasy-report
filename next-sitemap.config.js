/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: "https://thefantasyreport.com",
  generateRobotsTxt: true,
  sitemapSize: 5000,
  exclude: ["/admin/*", "/api/*"],
  changefreq: "daily",
  priority: 0.7,
};
