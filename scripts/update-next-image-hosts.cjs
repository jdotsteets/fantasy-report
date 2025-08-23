// scripts/update-next-image-hosts.cjs
// Usage:
//   export DATABASE_URL="postgres://...aws-1-...pooler.supabase.com:5432/postgres?sslmode=require"
//   # optional: PGSSLMODE=no-verify  (to skip cert verify for local/dev)
//   node scripts/update-next-image-hosts.cjs

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const NEXT_CONFIG_PATH = path.resolve(process.cwd(), "next.config.ts");

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "-" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

function normalizeDbUrl(raw) {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    // Add sslmode=require if not present; pooler generally wants TLS
    if (!u.searchParams.has("sslmode")) {
      u.searchParams.set("sslmode", "require");
      return u.toString();
    }
    return raw;
  } catch {
    return raw;
  }
}

function sslConfigFromEnv() {
  const mode = (process.env.PGSSLMODE || "").toLowerCase();
  // Common values:
  // - require      -> verify cert (may fail locally)
  // - verify-full  -> strict verification
  // - no-verify    -> skip verification (good for local/dev)
  if (mode === "no-verify") return { rejectUnauthorized: false };
  if (mode === "verify-full" || mode === "require") return { rejectUnauthorized: true };
  // default: be lenient for local/dev (you can tighten this in CI/Prod)
  return { rejectUnauthorized: false };
}

async function makePool(connString, sslOpt) {
  return new Pool({
    connectionString: connString,
    ssl: sslOpt,
  });
}

async function fetchHostsFromDB() {
  let conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL is not set in env.");
  conn = normalizeDbUrl(conn);

  // First attempt: respect PGSSLMODE (or default to no-verify)
  let ssl = sslConfigFromEnv();

  let pool = await makePool(conn, ssl);
  try {
    const sql = `
      select distinct split_part(split_part(image_url, '://', 2), '/', 1) as host
      from articles
      where image_url is not null
        and image_url <> ''
        and image_url not like 'data:%'
        and image_url not like 'blob:%'
      order by host
    `;
    const res = await pool.query(sql);
    return res.rows.map((r) => r.host).filter(Boolean);
  } catch (err) {
    // If we explicitly tried verify and got self-signed, retry once with no-verify
    if (err && (err.code === "SELF_SIGNED_CERT_IN_CHAIN" || /self-signed/i.test(String(err)))) {
      try {
        await pool.end();
      } catch {}
      // Retry with no-verify
      ssl = { rejectUnauthorized: false };
      pool = await makePool(conn, ssl);
      const sql = `
        select distinct split_part(split_part(image_url, '://', 2), '/', 1) as host
        from articles
        where image_url is not null
          and image_url <> ''
          and image_url not like 'data:%'
          and image_url not like 'blob:%'
        order by host
      `;
      const res = await pool.query(sql);
      return res.rows.map((r) => r.host).filter(Boolean);
    }
    throw err;
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

function extractExistingHosts(nextConfigText) {
  const hostRe = /hostname\s*:\s*["'`]([^"'`]+)["'`]/g;
  const out = new Set();
  let m;
  while ((m = hostRe.exec(nextConfigText))) out.add(m[1]);
  return out;
}

function buildRemotePatterns(hosts) {
  return (
    "remotePatterns: [\n" +
    hosts.map((h) => `      { protocol: "https", hostname: "${h}" },`).join("\n") +
    "\n    ],"
  );
}

function mergeIntoNextConfig(nextConfigText, mergedHosts) {
  const patternsBlock = buildRemotePatterns(mergedHosts);
  const re = /remotePatterns\s*:\s*\[(?:[\s\S]*?)\]/m;

  if (re.test(nextConfigText)) {
    return nextConfigText.replace(re, patternsBlock);
  }

  const imagesRe = /images\s*:\s*\{([\s\S]*?)\}/m;
  if (imagesRe.test(nextConfigText)) {
    return nextConfigText.replace(imagesRe, (full, inner) => {
      const trimmed = inner.trim();
      const needsComma = trimmed.length > 0 && !trimmed.endsWith(",");
      const prefix = needsComma ? trimmed + ",\n" : trimmed ? trimmed + "\n" : "";
      return `images: {\n    ${patternsBlock}\n    ${prefix}}`;
    });
  }

  const configRe = /const\s+nextConfig\s*:\s*NextConfig\s*=\s*\{([\s\S]*?)\};/m;
  if (configRe.test(nextConfigText)) {
    return nextConfigText.replace(configRe, (full, inner) => {
      const injected = `images: {\n    ${patternsBlock}\n  },\n  ${inner}`;
      return full.replace(inner, injected);
    });
  }

  return nextConfigText.replace(
    /export\s+default\s+nextConfig\s*;/,
    `const __autoImages = {\n  ${patternsBlock}\n};\n\nexport default nextConfig;`
  );
}

(async function main() {
  try {
    if (!fs.existsSync(NEXT_CONFIG_PATH)) {
      throw new Error(`Cannot find ${NEXT_CONFIG_PATH}`);
    }
    const nextConfigText = fs.readFileSync(NEXT_CONFIG_PATH, "utf8");

    const dbHosts = await fetchHostsFromDB();
    const fileHosts = Array.from(extractExistingHosts(nextConfigText));

    const sticky = new Set([
      "images.unsplash.com", // keep your fallback
    ]);

    const merged = new Set([...dbHosts, ...fileHosts, ...sticky]);
    for (const bad of ["", "undefined", "null"]) merged.delete(bad);

    const mergedSorted = Array.from(merged).sort((a, b) => a.localeCompare(b));
    const updatedText = mergeIntoNextConfig(nextConfigText, mergedSorted);

    const backupPath = `${NEXT_CONFIG_PATH}.bak.${nowStamp()}`;
    fs.writeFileSync(backupPath, nextConfigText, "utf8");
    fs.writeFileSync(NEXT_CONFIG_PATH, updatedText, "utf8");

    console.log(`✅ Updated next.config.ts`);
    console.log(`🗂  Backup written: ${backupPath}`);
    console.log(`🧩 Hosts added (${mergedSorted.length}):`);
    for (const h of mergedSorted) console.log("  -", h);
    console.log("\n➡ Restart your dev server so Next picks up the new image hosts.");
  } catch (err) {
    console.error("❌ Failed to update next.config.ts");
    console.error(err);
    process.exit(1);
  }
})();
