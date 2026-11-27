/**
 * Farben & Abstände der App – an EINER Stelle, damit das Design einheitlich bleibt.
 * Es gibt ein helles und ein dunkles Farbschema (folgt der Handy-Einstellung).
 */
import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0F172A',
    textSecondary: '#64748B',
    background: '#F8FAFC',
    card: '#FFFFFF',
    border: '#E2E8F0',
    primary: '#0F9D58', // RadPark-Grün
    primaryText: '#FFFFFF',
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
    muted: '#94A3B8',
  },
  dark: {
    text: '#F1F5F9',
    textSecondary: '#94A3B8',
    background: '#0B1120',
    card: '#151E2E',
    border: '#1E293B',
    primary: '#22C55E',
    primaryText: '#052E16',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
    muted: '#64748B',
  },
} as const;

export type ThemeColors = (typeof Colors)['light'] | (typeof Colors)['dark'];

export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const Radius = { sm: 8, md: 14, lg: 20 } as const;

/**
 * Im Browser (nur Entwicklungs-Vorschau) liegt die Tab-Leiste OBEN über dem Inhalt,
 * auf Android/iOS unten. Diesen Abstand lassen die Bildschirme im Browser oben frei.
 */
export const WebTabInset = Platform.OS === 'web' ? 72 : 0;
