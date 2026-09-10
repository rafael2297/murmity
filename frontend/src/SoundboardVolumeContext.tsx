import { createContext, useContext, useState, ReactNode } from "react";

const STORAGE_KEY = "soundboardVolume";
const DEFAULT_VOLUME = 1; // 100%

interface SoundboardVolumeContextValue {
  /** 0 a 1. */
  volume: number;
  setVolume: (v: number) => void;
}

const SoundboardVolumeContext = createContext<SoundboardVolumeContextValue>({
  volume: DEFAULT_VOLUME,
  setVolume: () => {},
});

function loadInitialVolume(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_VOLUME;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_VOLUME;
}

/**
 * Volume dos sons do soundboard — controla tanto os sons que VOCÊ toca
 * (o monitor local, o que você ouve ao clicar) quanto os que chegam de
 * outra pessoa na call. Cada pessoa tem o seu próprio, salvo localmente
 * (não é sincronizado com ninguém, e não muda o volume de quem ESCUTA
 * você — só afeta o que toca no seu próprio alto-falante).
 *
 * Fica no topo do App inteiro (mesmo padrão do UpdateProvider) — assim o
 * SoundboardAudioRenderer (dentro da call) e os dois controles visuais
 * (painel de usar soundboard + Configurações) sempre leem o mesmo valor,
 * mesmo estando em partes bem separadas da árvore de componentes.
 */
export function SoundboardVolumeProvider({ children }: { children: ReactNode }) {
  const [volume, setVolumeState] = useState(loadInitialVolume);

  function setVolume(v: number) {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    localStorage.setItem(STORAGE_KEY, String(clamped));
  }

  return (
    <SoundboardVolumeContext.Provider value={{ volume, setVolume }}>
      {children}
    </SoundboardVolumeContext.Provider>
  );
}

export function useSoundboardVolume() {
  return useContext(SoundboardVolumeContext);
}
