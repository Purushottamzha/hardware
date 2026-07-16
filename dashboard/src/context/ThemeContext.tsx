import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

export interface ThemeColors {
  bg: string;
  cardBg: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
  accentText: string;
  danger: string;
  dangerBg: string;
  dangerText: string;
  warning: string;
  warningBg: string;
  warningText: string;
  inputBg: string;
  inputBorder: string;
  headerBg: string;
  headerBorder: string;
  tableRowHover: string;
  tableRowSelected: string;
  liveDot: string;
  chipBg: string;
}

const light: ThemeColors = {
  bg: '#f0f2f5',
  cardBg: '#ffffff',
  cardBorder: '#e2e8f0',
  text: '#1e293b',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',
  accent: '#0d9488',
  accentBg: '#ccfbf1',
  accentBorder: '#5eead4',
  accentText: '#0d9488',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  dangerText: '#dc2626',
  warning: '#f59e0b',
  warningBg: '#fffbeb',
  warningText: '#d97706',
  inputBg: '#ffffff',
  inputBorder: '#cbd5e1',
  headerBg: '#ffffff',
  headerBorder: '#e2e8f0',
  tableRowHover: '#f8fafc',
  tableRowSelected: '#f0fdfa',
  liveDot: '#22c55e',
  chipBg: '#f1f5f9',
};

const dark: ThemeColors = {
  bg: '#0A0E14',
  cardBg: '#121826',
  cardBorder: 'rgba(255,255,255,0.06)',
  text: '#E8ECF1',
  textSecondary: 'rgba(255,255,255,0.6)',
  textMuted: 'rgba(255,255,255,0.35)',
  accent: '#2dd4bf',
  accentBg: 'rgba(45,212,191,0.10)',
  accentBorder: 'rgba(45,212,191,0.30)',
  accentText: '#2dd4bf',
  danger: '#f87171',
  dangerBg: 'rgba(248,113,113,0.10)',
  dangerText: '#f87171',
  warning: '#fbbf24',
  warningBg: 'rgba(251,191,36,0.10)',
  warningText: '#fbbf24',
  inputBg: 'rgba(255,255,255,0.04)',
  inputBorder: 'rgba(255,255,255,0.08)',
  headerBg: '#121826',
  headerBorder: 'rgba(255,255,255,0.06)',
  tableRowHover: 'rgba(255,255,255,0.02)',
  tableRowSelected: 'rgba(45,212,191,0.06)',
  liveDot: '#2dd4bf',
  chipBg: 'rgba(255,255,255,0.04)',
};

interface ThemeContextValue {
  theme: Theme;
  colors: ThemeColors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem('saferide-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {}
    return 'dark';
  });

  useEffect(() => {
    try { localStorage.setItem('saferide-theme', theme); } catch {}
    const root = document.documentElement;
    const c = theme === 'dark' ? dark : light;
    root.style.setProperty('--color-bg', c.bg);
    root.style.setProperty('--color-card-bg', c.cardBg);
    root.style.setProperty('--color-hover', c.tableRowHover);
    root.style.setProperty('--color-selected', c.tableRowSelected);
    root.style.setProperty('--color-text', c.text);
    root.style.setProperty('--color-text-secondary', c.textSecondary);
    root.style.setProperty('--color-text-muted', c.textMuted);
    root.style.setProperty('--color-border', c.cardBorder);
    root.style.setProperty('--color-input-bg', c.inputBg);
    root.style.setProperty('--color-input-border', c.inputBorder);
    root.style.setProperty('--color-header-bg', c.headerBg);
    root.style.setProperty('--color-header-border', c.headerBorder);
  }, [theme]);

  const colors = theme === 'dark' ? dark : light;
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, colors, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
