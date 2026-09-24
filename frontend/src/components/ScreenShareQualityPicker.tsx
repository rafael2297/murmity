import { useState } from "react";

export interface ScreenShareQuality {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
}

interface Props {
  onConfirm: (quality: ScreenShareQuality) => void;
  onCancel: () => void;
}

type ResolutionKey = "720" | "1080" | "source";
type FpsKey = "15" | "30" | "60";

// Bitrate por combinação de resolução+fps — mesma ideia do seletor de
// qualidade do Discord (mais pixel e mais quadro por segundo = mais
// banda). Valores generosos (isso aqui não tem "Nitro" limitando
// ninguém), mas com teto pensado pra rede residencial brasileira, onde o
// upload costuma ser o gargalo real, não o download.
const BITRATE_TABLE: Record<ResolutionKey, Record<FpsKey, number>> = {
  "720": { "15": 1_500_000, "30": 2_500_000, "60": 4_000_000 },
  "1080": { "15": 2_500_000, "30": 4_000_000, "60": 8_000_000 },
  source: { "15": 4_000_000, "30": 6_000_000, "60": 10_000_000 },
};

const RESOLUTION_DIMENSIONS: Record<ResolutionKey, { width: number; height: number }> = {
  "720": { width: 1280, height: 720 },
  "1080": { width: 1920, height: 1080 },
  // "Fonte": não força downscale pra baixo — usa a resolução nativa da
  // tela/janela escolhida. 2560x1440 aqui é só um TETO razoável, pra não
  // deixar o navegador tentar capturar em 8K de um monitor 4K+/duplo à
  // toa; uma tela menor que isso captura na resolução dela mesma.
  source: { width: 2560, height: 1440 },
};

const RESOLUTION_LABELS: Record<ResolutionKey, string> = {
  "720": "720p",
  "1080": "1080p",
  source: "Fonte",
};

/**
 * Passo de qualidade do compartilhamento de tela — aparece depois de
 * escolher O QUE compartilhar (no Electron, depois do ScreenSharePicker;
 * no navegador, antes do seletor nativo do próprio SO), igual ao "Ir ao
 * vivo" do Discord: escolhe resolução e fps, e só DEPOIS disso a
 * transmissão realmente começa.
 *
 * Isso substitui os valores fixos que existiam antes (1080p/30fps/4Mbps
 * sempre) por uma escolha manual — quem tem upload fraco consegue cair
 * pra 720p/15fps na mão, em vez de travar tentando forçar qualidade alta.
 * Não é adaptação AUTOMÁTICA por banda disponível (isso ainda não existe
 * — ver PROJECT_CONTEXT.md), é o controle manual mesmo.
 */
export default function ScreenShareQualityPicker({ onConfirm, onCancel }: Props) {
  const [resolution, setResolution] = useState<ResolutionKey>("1080");
  const [fps, setFps] = useState<FpsKey>("30");

  function confirm() {
    const dims = RESOLUTION_DIMENSIONS[resolution];
    onConfirm({
      width: dims.width,
      height: dims.height,
      frameRate: Number(fps),
      maxBitrate: BITRATE_TABLE[resolution][fps],
    });
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal screen-quality-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Qualidade da transmissão</h3>
        </div>

        <div className="screen-quality-section">
          <div className="screen-quality-label">Resolução</div>
          <div className="screen-quality-options">
            {(["720", "1080", "source"] as ResolutionKey[]).map((key) => (
              <button
                key={key}
                className={`screen-quality-btn ${resolution === key ? "selected" : ""}`}
                onClick={() => setResolution(key)}
              >
                {RESOLUTION_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="screen-quality-section">
          <div className="screen-quality-label">Quadros por segundo</div>
          <div className="screen-quality-options">
            {(["15", "30", "60"] as FpsKey[]).map((key) => (
              <button
                key={key}
                className={`screen-quality-btn ${fps === key ? "selected" : ""}`}
                onClick={() => setFps(key)}
              >
                {key} fps
              </button>
            ))}
          </div>
        </div>

        <p className="screen-quality-note">
          Quanto maior a qualidade, mais banda de upload é usada. Se a transmissão travar ou atrasar
          pros outros, tente uma opção menor.
        </p>

        <div className="screen-quality-actions">
          <button className="secondary-btn" onClick={onCancel}>
            Cancelar
          </button>
          <button className="screen-quality-confirm-btn" onClick={confirm}>
            Compartilhar tela
          </button>
        </div>
      </div>
    </div>
  );
}
