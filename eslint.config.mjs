import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { webpack }) {
    // Force a JS hash (optional; keeps logs readable)
    config.output.hashFunction = 'xxhash64';

    // Debug assets with undefined source (guarded by env)
    if (process.env.DEBUG_UNDEFINED_ASSETS === '1') {
      class DebugUndefinedAssetsPlugin {
        apply(compiler) {
          compiler.hooks.compilation.tap('DebugUndefinedAssets', (compilation) => {
            compilation.hooks.processAssets.tap(
              { name: 'DebugUndefinedAssets', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT },
              (assets) => {
                for (const [name, src] of Object.entries(assets)) {
                  try {
                    const val =
                      typeof src?.source === 'function'
                        ? src.source()
                        : (src ?? undefined);
                    if (val === undefined) {
                      console.error('[webpack] asset has undefined source:', name);
                    }
                  } catch (err) {
                    console.error('[webpack] error reading asset:', name, err);
                  }
                }
              }
            );
          });
        }
      }
      config.plugins.push(new DebugUndefinedAssetsPlugin());
    }

    return config;
  },
};



export default eslintConfig;


