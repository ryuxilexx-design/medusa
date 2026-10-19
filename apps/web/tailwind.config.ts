import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Med.uz.ai logo blues (navy #1f3b78 … sky #6cc2ec). 600+ pass 4.5:1 with white text.
        brand: { 50: '#eef5fd', 100: '#d9e8fa', 200: '#b9d4f4', 300: '#8db8ec', 400: '#6399e0', 500: '#4a86d6', 600: '#2d64bd', 700: '#25519c', 800: '#1f3b78', 900: '#1a2f5e' },
      },
      fontFamily: { sans: ['"Inter"', '"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'] },
      fontSize: { '2xs': ['11px', '14px'] },
    },
  },
  plugins: [],
} satisfies Config;
