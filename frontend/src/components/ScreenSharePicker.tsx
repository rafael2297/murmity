import { useEffect, useMemo, useState } from "react";
import { Monitor, AppWindow, MonitorX } from "lucide-react";

interface DesktopSource {
  id: string;
  name: string;
  thumbnailDataURL: string;
  type: "screen" | "window";
}

interface Props {
  // "edit" é usado quando já tem uma transmissão rolando e a pessoa quer
  // trocar de janela/tela — muda o título e mostra a opção de parar de
  // vez, sem precisar terminar de escolher uma fonte nova só pra isso.
  mode?: "start" | "edit";
  onPick: (sourceId: string) => void;
  onCancel: () => void;
  onStop?: () => void;
}

type Tab = "screen" | "window";

export default function ScreenSharePicker({ mode = "start", onPick, onCancel, onStop }: Props) {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [loading, setLoading] = useState(true);
  // Começa em "Telas" (igual ao Discord) — se não tiver nenhuma tela
  // detectada por algum motivo, cai pra "Aplicativos" assim que a lista
  // carregar (ver useEffect abaixo).
  const [tab, setTab] = useState<Tab>("screen");

  useEffect(() => {
    (window as any).electronAPI
      .getDesktopSources()
      .then((s: DesktopSource[]) => {
        setSources(s);
        setLoading(false);
        if (!s.some((source) => source.type === "screen") && s.some((source) => source.type === "window")) {
          setTab("window");
        }
      })
      .catch(() => setLoading(false));
  }, []);

  const screenSources = useMemo(() => sources.filter((s) => s.type === "screen"), [sources]);
  const windowSources = useMemo(() => sources.filter((s) => s.type === "window"), [sources]);
  const visibleSources = tab === "screen" ? screenSources : windowSources;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal screen-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{mode === "edit" ? "Trocar para qual tela/janela?" : "O que você quer compartilhar?"}</h3>
        </div>

        <div className="screen-picker-tabs">
          <button
            className={`screen-picker-tab ${tab === "screen" ? "selected" : ""}`}
            onClick={() => setTab("screen")}
          >
            <Monitor size={16} />
            Telas
            {screenSources.length > 0 && <span className="screen-picker-tab-count">{screenSources.length}</span>}
          </button>
          <button
            className={`screen-picker-tab ${tab === "window" ? "selected" : ""}`}
            onClick={() => setTab("window")}
          >
            <AppWindow size={16} />
            Aplicativos
            {windowSources.length > 0 && <span className="screen-picker-tab-count">{windowSources.length}</span>}
          </button>
        </div>

        {loading && <p className="device-select-empty">Carregando telas e janelas...</p>}

        {!loading && visibleSources.length === 0 && (
          <p className="device-select-empty">
            {tab === "screen" ? "Nenhuma tela encontrada." : "Nenhum aplicativo com janela aberta encontrado."}
          </p>
        )}

        <div className="screen-picker-grid">
          {visibleSources.map((s) => (
            <button key={s.id} className="screen-picker-item" onClick={() => onPick(s.id)}>
              <img src={s.thumbnailDataURL} alt={s.name} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>

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
        </div>
      </div>
    </div>
  );
}
