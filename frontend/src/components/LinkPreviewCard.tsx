import { LinkPreview } from "../api";

interface Props {
  preview: Extract<LinkPreview, { type: "generic" }>;
}

/**
 * Card de preview genérico (Open Graph) — nome do site, título clicável,
 * descrição (se tiver) e uma imagem (se tiver). Mesma família visual do
 * YoutubeEmbed.tsx (reaproveita as classes .link-embed*), só sem o player
 * embutido — aqui é sempre "abre numa aba nova".
 */
export default function LinkPreviewCard({ preview }: Props) {
  return (
    <div className="link-embed generic-embed">
      <div className="link-embed-site">{preview.siteName}</div>
      <a href={preview.url} target="_blank" rel="noreferrer" className="link-embed-title">
        {preview.title}
      </a>
      {preview.description && <p className="generic-embed-description">{preview.description}</p>}
      {preview.imageUrl && (
        <a href={preview.url} target="_blank" rel="noreferrer" className="generic-embed-image-link">
          <img className="generic-embed-image" src={preview.imageUrl} alt="" loading="lazy" />
        </a>
      )}
    </div>
  );
}
