import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ThemeMode } from '@/types';
import { Sun, Moon, Laptop } from 'lucide-react';

interface ThemeContextType {
  theme: ThemeMode;
  effectiveTheme: 'light' | 'dark';
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  effectiveTheme: 'light',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('raterx-theme') as ThemeMode | null;
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });

  const [systemIsDark, setSystemIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  const effectiveTheme: 'light' | 'dark' = theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  }, [effectiveTheme]);

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    localStorage.setItem('raterx-theme', newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle({ className = '', showLabel = false }: { className?: string; showLabel?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={`inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors ${className}`}>
      <button
        type="button"
        onClick={() => setTheme('light')}
        title="Light Mode"
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
          theme === 'light'
            ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        <Sun size={14} />
        {showLabel && <span>Light</span>}
      </button>

      <button
        type="button"
        onClick={() => setTheme('dark')}
        title="Dark Mode"
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
          theme === 'dark'
            ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        <Moon size={14} />
        {showLabel && <span>Dark</span>}
      </button>

      <button
        type="button"
        onClick={() => setTheme('system')}
        title="System Preference"
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
          theme === 'system'
            ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        <Laptop size={14} />
        {showLabel && <span>System</span>}
      </button>
    </div>
  );
}
