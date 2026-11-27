/**
 * 🛠 Entwickler-Knopf: steuert den SIMULATOR wie eine Person am Ständer
 * ("Rad einstellen" / "Rad entnehmen"). Erscheint nur im Entwicklungsmodus (__DEV__) –
 * in der veröffentlichten App gibt es ihn nicht, dort macht das ja der echte Mensch.
 */
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/button';
import { Banner } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/format';

interface Props {
  stationCode: string;
  dock: number;
  action: 'park' | 'take';
}

export function DevSimButton({ stationCode, dock, action }: Props) {
  const sim = useMutation({ mutationFn: () => api.devSimulate(stationCode, dock, action) });
  if (!__DEV__) return null;
  return (
    <>
      <Button
        variant="secondary"
        title={action === 'park' ? '🛠 Simulator: Rad einstellen' : '🛠 Simulator: Rad entnehmen'}
        loading={sim.isPending}
        onPress={() => sim.mutate()}
        style={{ alignSelf: 'stretch', borderStyle: 'dashed' }}
      />
      {sim.isError && <Banner>{errorMessage(sim.error)}</Banner>}
    </>
  );
}
