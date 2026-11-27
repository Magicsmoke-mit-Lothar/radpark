/**
 * 🛠 Simulator-Knopf: steuert den SIMULATOR wie eine Person am Ständer
 * ("Rad einstellen" / "Rad entnehmen"). Erscheint nur, wenn der Server das erlaubt
 * (GET /meta → simulatorControl) – also in der Entwicklung oder auf einem Testserver,
 * nie bei echten Ständern.
 */
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/button';
import { Banner } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/format';
import { useServerMeta } from '@/lib/queries';

interface Props {
  stationCode: string;
  dock: number;
  action: 'park' | 'take';
}

export function DevSimButton({ stationCode, dock, action }: Props) {
  const meta = useServerMeta();
  const sim = useMutation({ mutationFn: () => api.simulate(stationCode, dock, action) });
  if (!meta.data?.simulatorControl) return null;
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
