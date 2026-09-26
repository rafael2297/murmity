import { useState } from "react";
import { MonitorX } from "lucide-react";

export interface ScreenShareQuality {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
}

interface Props {
  // "edit" é usado quando já tem uma transmissão rolando — muda o texto
  // do botão de confirmar e mostra a opção de parar de vez.
  mode?: "start" | "edit";
  // Pré-seleciona a qualidade já em uso, em vez de sempre voltar pro
  // padrão 1080p/30fps ao abrir o modal de edição.
  initialQuality?: ScreenShareQuality;
  onConfirm: (quality: ScreenShareQuality) => void;
  onCancel: () => void;
  onStop?: () => void;
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
 * Escada de qualidade, da mais baixa pra mais alta — usada pela adaptação
 * automática (ver VoiceUserBar.tsx) pra saber qual é "um degrau abaixo"
 * da qualidade atual quando a conexão fica ruim. A ordem aqui é uma
 * escolha de bom senso (fps baixo em resolução baixa perde menos do que
 * pular direto pra uma resolução maior), não uma métrica exata.
 */
export const QUALITY_LADDER: ScreenShareQuality[] = (
  [
    ["720", "15"],
    ["720", "30"],
    ["1080", "15"],
    ["720", "60"],
    ["1080", "30"],
    ["source", "15"],
    ["1080", "60"],
    ["source", "30"],
    ["source", "60"],
  ] as [ResolutionKey, FpsKey][]
).map(([res, fps]) => ({
  width: RESOLUTION_DIMENSIONS[res].width,
  height: RESOLUTION_DIMENSIONS[res].height,
  frameRate: Number(fps),
  maxBitrate: BITRATE_TABLE[res][fps],
}));

/** Posição de uma qualidade na escada acima (ou -1 se não bater com nenhum degrau conhecido). */
export function findLadderIndex(quality: ScreenShareQuality): number {
  return QUALITY_LADDER.findIndex(
    (q) => q.width === quality.width && q.height === quality.height && q.frameRate === quality.frameRate
  );
}

/** Um degrau abaixo na escada, ou null se já estiver no mais baixo possível (ou fora da escada). */
export function stepDownQuality(quality: ScreenShareQuality): ScreenShareQuality | null {
  const index = findLadderIndex(quality);
  if (index <= 0) return null;
  return QUALITY_LADDER[index - 1];
}

/** Descobre qual botão de resolução bate com a qualidade atual (usado só pra pré-selecionar no modo edição). */
function resolutionKeyFromQuality(quality: ScreenShareQuality | undefined): ResolutionKey {
  if (!quality) return "1080";
  const match = (Object.keys(RESOLUTION_DIMENSIONS) as ResolutionKey[]).find(
    (key) =>
      RESOLUTION_DIMENSIONS[key].width === quality.width &&
      RESOLUTION_DIMENSIONS[key].height === quality.height
  );
  return match ?? "1080";
}

/**
 * Passo de qualidade do compartilhamento de tela — aparece depois de
 * escolher O QUE compartilhar (no Electron, depois do ScreenSharePicker;
 * no navegador, antes do seletor nativo do próprio SO), igual ao "Ir ao
 * vivo" do Discord: escolhe resolução e fps, e só DEPOIS disso a
 * transmissão realmente começa (ou é atualizada, no modo edição).
 *
 * Isso substitui os valores fixos que existiam antes (1080p/30fps/4Mbps
 * sempre) por uma escolha manual — quem tem upload fraco consegue cair
 * pra 720p/15fps na mão, em vez de travar tentando forçar qualidade alta.
 * Não é adaptação AUTOMÁTICA por banda disponível (isso ainda não existe
 * — ver PROJECT_CONTEXT.md), é o controle manual mesmo.
 */
export default function ScreenShareQualityPicker({
  mode = "start",
  initialQuality,
  onConfirm,
  onCancel,
  onStop,
}: Props) {
  const [resolution, setResolution] = useState<ResolutionKey>(() => resolutionKeyFromQuality(initialQuality));
  const [fps, setFps] = useState<FpsKey>(() => (initialQuality ? (String(initialQuality.frameRate) as FpsKey) : "30"));

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
          <h3>{mode === "edit" ? "Trocar qualidade da transmissão" : "Qualidade da transmissão"}</h3>
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
          {mode === "edit" && onStop && (
            <button className="screen-quality-stop-btn" onClick={onStop}>
              <MonitorX size={16} />
              Parar de compartilhar
            </button>
          )}
          <button className="screen-quality-confirm-btn" onClick={confirm}>
            {mode === "edit" ? "Aplicar mudanças" : "Compartilhar tela"}
          </button>
        </div>
      </div>
    </div>
  );
}
