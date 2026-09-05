import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm charcoal, not the generic cool blue-black — same 5-step
        // scale every component already references (bg-ink-900 etc.),
        // just re-valued so the whole app re-themes from one place.
        ink: {
          950: "#110d09",
          900: "#1c1611",
          800: "#28201a",
          700: "#392e24",
          600: "#4d3f30",
        },
        // Overrides Tailwind's built-in emerald scale (used throughout as
        // the app's one accent) with a warm brass/gold instead of the
        // generic SaaS acid-green — distinct, still reads clearly as "the
        // accent" against the warm charcoal background.
        emerald: {
          300: "#f0c877",
          400: "#dfa63e",
          500: "#c98b25",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
