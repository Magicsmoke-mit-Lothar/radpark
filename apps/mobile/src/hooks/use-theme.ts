import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Liefert die Farben passend zum hellen/dunklen Modus des Handys */
export function useTheme() {
  return useColorScheme() === 'dark' ? Colors.dark : Colors.light;
}
