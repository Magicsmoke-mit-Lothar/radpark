/** Tab "Verlauf": alle bisherigen Parkvorgänge */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Banner, Card } from '@/components/ui';
import { Spacing, WebTabInset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Parking } from '@/lib/api';
import { endReasonText, errorMessage, formatDateTime, formatDuration, formatMoney } from '@/lib/format';
import { useHistory } from '@/lib/queries';

export default function HistoryScreen() {
  const c = useTheme();
  const history = useHistory();

  // Jedes Mal neu laden, wenn der Tab geöffnet wird
  useFocusEffect(
    useCallback(() => {
      history.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return (
    <SafeAreaView edges={['top']} style={[styles.flex, { backgroundColor: c.background }]}>
      <FlatList
        data={history.data ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={history.isRefetching} onRefresh={() => void history.refetch()} />}
        ListHeaderComponent={
          <View style={{ gap: Spacing.md }}>
            <AppText variant="title">Verlauf</AppText>
            {history.isError && <Banner>{errorMessage(history.error)}</Banner>}
          </View>
        }
        ListEmptyComponent={
          history.isSuccess ? <AppText variant="secondary">Noch keine Parkvorgänge.</AppText> : undefined
        }
        renderItem={({ item }) => <HistoryItem p={item} />}
      />
    </SafeAreaView>
  );
}

function HistoryItem({ p }: { p: Parking }) {
  const c = useTheme();
  const duration = p.startedAt && p.endedAt ? new Date(p.endedAt).getTime() - new Date(p.startedAt).getTime() : null;
  const reason = endReasonText(p.endReason);
  const running = p.status === 'reserved' || p.status === 'active';

  return (
    <Card style={styles.item}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="heading" style={{ fontSize: 17 }}>
          {p.stationName}
        </AppText>
        <AppText variant="small">
          {formatDateTime(p.reservedAt)} · Platz {p.dockNumber}
          {duration !== null ? ` · ${formatDuration(duration)}` : ''}
        </AppText>
        {reason && <AppText variant="small">{reason}</AppText>}
      </View>
      <AppText variant="heading" style={{ color: running ? c.primary : c.text, fontSize: 17 }}>
        {running ? 'läuft' : p.status === 'completed' ? formatMoney(p.priceCents ?? 0, p.currency) : '–'}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.md, paddingTop: Spacing.md + WebTabInset, gap: Spacing.sm, maxWidth: 560, width: '100%', alignSelf: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
});
