import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

/** Großer, gut tippbarer Knopf – zeigt beim Laden einen Spinner und ist dann gesperrt */
export function Button({ title, onPress, variant = 'primary', disabled, loading, style }: ButtonProps) {
  const c = useTheme();
  const background = variant === 'primary' ? c.primary : variant === 'danger' ? c.danger : c.card;
  const color = variant === 'primary' ? c.primaryText : variant === 'danger' ? '#FFFFFF' : c.text;
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderColor: variant === 'secondary' ? c.border : background },
        inactive && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}>
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.text, { color }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 17, fontWeight: '700' },
});
