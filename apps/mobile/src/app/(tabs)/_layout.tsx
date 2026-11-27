/**
 * Die vier Tabs unten. "NativeTabs" nutzt die echte Android-Tableiste (Material Design),
 * Symbole: md = Android Material Symbols, sf = iOS SF Symbols.
 */
import { NativeTabs } from 'expo-router/native-tabs';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const c = useTheme();
  return (
    <NativeTabs backgroundColor={c.card} indicatorColor={c.border} labelStyle={{ selected: { color: c.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Karte</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="map" md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="parking">
        <NativeTabs.Trigger.Label>Mein Rad</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bicycle" md="pedal_bike" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>Verlauf</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock" md="history" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profil</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person" md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
