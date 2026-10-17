import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#effcfa', 100: '#c9f2ec', 200: '#97e3d9', 300: '#5ccdc1', 400: '#2fb1a6', 500: '#17958c', 600: '#0f7872', 700: '#11605c', 800: '#124d4b', 900: '#13403f' },
      },
      fontFamily: { sans: ['"Inter"', '"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'] },
      fontSize: { '2xs': ['11px', '14px'] },
    },
  },
  plugins: [],
} satisfies Config;
