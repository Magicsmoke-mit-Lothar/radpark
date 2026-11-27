/** Kleine, überall genutzte Bausteine: Text, Karte (Kasten), Hinweis-Banner */
import { StyleSheet, Text, View, type TextProps, type ViewProps } from 'react-native';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'title' | 'heading' | 'body' | 'secondary' | 'small';

export function AppText({ variant = 'body', style, ...rest }: TextProps & { variant?: Variant }) {
  const c = useTheme();
  const color = variant === 'secondary' || variant === 'small' ? c.textSecondary : c.text;
  return <Text style={[styles[variant], { color }, style]} {...rest} />;
}

export function Card({ style, ...rest }: ViewProps) {
  const c = useTheme();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]} {...rest} />;
}

export function Banner({ tone = 'danger', children }: { tone?: 'danger' | 'warning' | 'success'; children: string }) {
  const c = useTheme();
  return (
    <View style={[styles.banner, { borderColor: c[tone] }]}>
      <Text style={{ color: c[tone], fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800' },
  heading: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 16 },
  secondary: { fontSize: 15 },
  small: { fontSize: 13 },
  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.md, gap: Spacing.sm },
  banner: { borderWidth: 1.5, borderRadius: Radius.sm, padding: Spacing.md },
});
