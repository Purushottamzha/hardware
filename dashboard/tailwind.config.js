/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--color-bg)',
          card: 'var(--color-card-bg)',
          hover: 'var(--color-hover)',
          selected: 'var(--color-selected)',
        },
        body: 'var(--color-text)',
        'body-secondary': 'var(--color-text-secondary)',
        'body-muted': 'var(--color-text-muted)',
        border: 'var(--color-border)',
        'header-bg': 'var(--color-header-bg)',
        'header-border': 'var(--color-header-border)',
        teal: {
          400: '#2dd4bf',
          500: '#14b8a6',
        },
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
