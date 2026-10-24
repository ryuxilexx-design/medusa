import type { Config } from 'tailwindcss';

/** A colour from a CSS variable holding "r g b" channels (globals.css :root), so opacity modifiers (`bg-brand-600/90`) keep working. */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

// Design tokens (docs/UI_GUIDE.md §2). Values live in globals.css :root; this file only names them.
// 1rem = 18px (html 112.5%), so every rem value below renders 18 × larger in px.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Med.uz.ai blues. 600 is THE accent (primary button, selected state, links' hover); 700 is link text.
        brand: { 50: v('brand-50'), 100: v('brand-100'), 200: v('brand-200'), 300: v('brand-300'), 400: v('brand-400'), 500: v('brand-500'), 600: v('brand-600'), 700: v('brand-700'), 800: v('brand-800'), 900: v('brand-900') },
        accent: v('brand-600'),
        // the one keyboard-focus colour (rings and the global outline)
        focus: v('focus'),
        // the one text colour (= slate-900)
        ink: v('ink'),
      },
      // Golos Text: made for public-service screens, Latin + Cyrillic (Uzbek both scripts, Russian ICD titles); bundled, works offline
      fontFamily: { sans: ['"Golos Text Variable"', '"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'Arial', 'sans-serif'] },
      // rem, so every label follows the 18px root. Plain sizes (no line-height) where they replace text-[…] one to one.
      // rendered px: 2xs 12.4 · xs 13.5 · small 14.6 · sm 15.75 · body 16.9 · base 18 · lg 20.25 · xl 22.5 · stat 24.75 · 2xl 27 · title 31.5
      fontSize: {
        '2xs': ['0.6875rem', '0.875rem'], // tags / badges only, never a sentence
        small: '0.8125rem', // captions, hints, table headers, secondary lines (was text-[0.8125rem])
        body: '0.9375rem', // controls (buttons, fields, tabs), list rows, card text (was text-[0.9375rem])
        stat: '1.375rem', // StatCard value
        title: ['1.75rem', '1.25'], // page title (PageHeader h1)
      },
      borderRadius: {
        field: 'var(--radius-field)', // Input / Select / Textarea / Alert
        surface: 'var(--radius-surface)', // .surface cards
        panel: 'var(--radius-panel)', // Modal, glass panels (sidebar)
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        popover: 'var(--shadow-popover)',
        modal: 'var(--shadow-modal)',
        pill: 'var(--shadow-pill)',
        primary: 'var(--shadow-primary)',
        // a selected list row: a 4px accent bar on the left edge
        selected: 'inset 4px 0 0 rgb(var(--brand-600))',
      },
      zIndex: {
        raised: '1', // items over a SlidingPill
        sticky: '10', // sticky bars and banners inside the page
        dropdown: '20', // in-content popovers (pickers, comboboxes)
        tabbar: '30', // phone tab bar
        header: '32', // the shell's top bar (its user menu must cover the tab bar)
        overlay: '35', // drawer backdrop
        drawer: '40', // the menu drawer / sidebar
        modal: '50',
        toast: '60',
        skip: '70', // «skip to content» link
      },
      spacing: {
        control: 'var(--control-h)', // 2.75rem = 49.5px: buttons, fields, segmented controls
        'control-sm': 'var(--control-h-sm)', // 2.5rem = 45px: dense tables and toolbars (still ≥ 44px)
      },
    },
  },
  plugins: [],
} satisfies Config;
