import { useState } from "react";
import { Play } from "lucide-react";
import { LinkPreview } from "../api";

interface Props {
  preview: Extract<LinkPreview, { type: "youtube" }>;
  sourceUrl: string;
}

/**
 * Card de preview de link do YouTube — miniatura com botão de play; ao
 * clicar, troca pelo player embutido de verdade (iframe do YouTube),
 * igual ao que o Discord faz.
 */
export default function YoutubeEmbed({ preview, sourceUrl }: Props) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="link-embed youtube-embed">
      <div className="link-embed-site">YouTube</div>
      {preview.authorName && <div className="link-embed-author">{preview.authorName}</div>}
      <a href={sourceUrl} target="_blank" rel="noreferrer" className="link-embed-title">
        {preview.title || sourceUrl}
      </a>

      {playing ? (
        <iframe
          className="youtube-embed-player"
          src={`https://www.youtube.com/embed/${preview.videoId}?autoplay=1`}
          title={preview.title || "Vídeo do YouTube"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button className="youtube-embed-thumb" onClick={() => setPlaying(true)} title="Assistir">
          <img src={preview.thumbnailUrl} alt={preview.title} loading="lazy" />
          <span className="youtube-embed-play-icon">
            <Play size={28} fill="white" color="white" />
          </span>
        </button>
      )}
    </div>
  );
}
