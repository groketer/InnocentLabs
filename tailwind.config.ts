import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0d10",
          900: "#12151a",
          800: "#1a1f27",
          700: "#242b36",
          600: "#333d4b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
