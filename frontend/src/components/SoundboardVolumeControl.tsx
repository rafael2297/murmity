import { Volume2, VolumeX } from "lucide-react";
import { useSoundboardVolume } from "../SoundboardVolumeContext";

/**
 * Slider de "volume de receber" do soundboard — usado tanto dentro do
 * painel de usar (SoundboardPanel.tsx) quanto nas Configurações
 * (SettingsModal.tsx), sempre lendo/escrevendo o mesmo valor
 * (SoundboardVolumeContext).
 */
export default function SoundboardVolumeControl() {
  const { volume, setVolume } = useSoundboardVolume();
  const percent = Math.round(volume * 100);

  return (
    <div className="soundboard-volume-control">
      {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
      <input
        type="range"
        min={0}
        max={100}
        value={percent}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
        title="Volume dos sons do soundboard (seus e de outras pessoas)"
      />
      <span className="soundboard-volume-value">{percent}%</span>
    </div>
  );
}
