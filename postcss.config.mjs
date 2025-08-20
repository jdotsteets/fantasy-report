/** @type {import('postcss-load-config').Config} */
export default {
  plugins: {
    "@tailwindcss/postcss": {}, // ✅ loads Tailwind v4
    autoprefixer: {},           // ✅ add this too
  },
};
