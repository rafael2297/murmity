import { useEffect, useState, useSyncExternalStore, useRef } from "react";
import { useParticipants, useRoomContext, useTracks } from "@livekit/components-react";
import { RoomEvent, Participant, Track, RemoteAudioTrack, LocalParticipant } from "livekit-client";
import { MicOff } from "lucide-react";
import { getVolume, getEffectiveVolume, setVolume, toggleMute, subscribe } from "../localAudioPrefs";

interface RowProps {
  participant: Participant;
  speaking: boolean;
  micTrack: Track | undefined;
  onContextMenu: (identity: string, x: number, y: number) => void;
}

function ParticipantRow({ participant, speaking, micTrack, onContextMenu }: RowProps) {
  const identity = participant.identity;
  const isLocal = participant instanceof LocalParticipant;

  const volume = useSyncExternalStore(subscribe, () => getVolume(identity));
  const muted = volume === 0;
  // O que realmente toca na track leva em conta o ensurdecer global também
  // (não só o mute/volume individual) — por isso um snapshot separado.
  const effectiveVolume = useSyncExternalStore(subscribe, () => getEffectiveVolume(identity));

  useEffect(() => {
    if (micTrack instanceof RemoteAudioTrack) micTrack.setVolume(effectiveVolume);
  }, [micTrack, effectiveVolume]);

  return (
    <div
      className={`voice-participant ${speaking ? "speaking" : ""} ${muted ? "muted" : ""}`}
      onContextMenu={(e) => {
        if (isLocal) return;
        e.preventDefault();
        onContextMenu(identity, e.clientX, e.clientY);
      }}
    >
      <span className={`user-avatar small ${speaking ? "speaking-ring" : ""}`}>
        {identity.slice(0, 2).toUpperCase()}
      </span>
      <span className="voice-participant-name">{identity}</span>
      {muted && (
        <span className="muted-badge" title={`Você mutou ${identity}`}>
          <MicOff size={13} />
        </span>
      )}
    </div>
  );
}

function VolumeContextMenu({
  identity,
  x,
  y,
  onClose,
}: {
  identity: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const volume = useSyncExternalStore(subscribe, () => getVolume(identity));
  const muted = volume === 0;

  return (
    <div className="context-menu-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="context-menu"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="context-menu-title">{identity}</div>
        <button className="context-menu-item" onClick={() => toggleMute(identity)}>
          {muted ? "Desmutar" : "Mutar"}
        </button>
        <div className="context-menu-slider-row">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(identity, Number(e.target.value))}
          />
          <span className="context-menu-volume-value">{Math.round(volume * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

export default function VoiceParticipants() {
  const participants = useParticipants();
  const room = useRoomContext();
  const speakingStore = useSpeakingSet(room);

  const micTracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }], {
    onlySubscribed: true,
  });

  const [menu, setMenu] = useState<{ identity: string; x: number; y: number } | null>(null);

  return (
    <div className="voice-participants">
      {participants.map((p) => {
        const micTrack = micTracks.find((t) => t.participant.identity === p.identity)?.publication
          ?.track;
        return (
          <ParticipantRow
            key={p.identity}
            participant={p}
            speaking={speakingStore.has(p.identity)}
            micTrack={micTrack}
            onContextMenu={(identity, x, y) => setMenu({ identity, x, y })}
          />
        );
      })}

      {menu && (
        <VolumeContextMenu
          identity={menu.identity}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// Hook pequeno só pra isolar a assinatura do evento de "quem está falando".
// useSyncExternalStore exige que getSnapshot devolva a MESMA referência
// enquanto nada mudou de verdade — por isso o cache num ref, em vez de
// criar um Set novo a cada chamada (isso causaria re-render infinito).
function useSpeakingSet(room: ReturnType<typeof useRoomContext>): Set<string> {
  const cacheRef = useRef(new Set(room.activeSpeakers.map((s) => s.identity)));

  const subscribeSpeaking = (callback: () => void) => {
    function handler(speakers: Participant[]) {
      cacheRef.current = new Set(speakers.map((s) => s.identity));
      callback();
    }
    room.on(RoomEvent.ActiveSpeakersChanged, handler);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, handler);
    };
  };

  return useSyncExternalStore(subscribeSpeaking, () => cacheRef.current);
}
