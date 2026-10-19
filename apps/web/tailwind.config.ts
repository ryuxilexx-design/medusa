import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Med.uz.ai logo blues (navy #1f3b78 … sky #6cc2ec). 600+ pass 4.5:1 with white text.
        brand: { 50: '#eef5fd', 100: '#d9e8fa', 200: '#b9d4f4', 300: '#8db8ec', 400: '#6399e0', 500: '#4a86d6', 600: '#2d64bd', 700: '#25519c', 800: '#1f3b78', 900: '#1a2f5e' },
      },
      // Golos Text: made for public-service screens, Latin + Cyrillic (Uzbek both scripts, Russian ICD titles); bundled, works offline
      fontFamily: { sans: ['"Golos Text Variable"', '"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'Arial', 'sans-serif'] },
      // rem, so the per-doctor «Katta» text size scales every label together
      fontSize: { '2xs': ['0.6875rem', '0.875rem'] },
    },
  },
  plugins: [],
} satisfies Config;
