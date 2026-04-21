import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {}
  },
  plugins: [typography, require("daisyui")],
  daisyui: {
    themes: ["dracula", "dark", "synthwave"], // Modern dark themes
  }
} satisfies Config;
