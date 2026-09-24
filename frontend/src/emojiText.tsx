import { ReactNode, useState } from "react";
import { CustomEmoji } from "./api";

const CODE_REGEX = /:([a-z0-9_]{2,32}):/g;

/**
 * Troca ":codigo:" pela imagem do emoji personalizado correspondente,
 * quando o código existir no mapa passado. Emoji nativo (unicode,
 * digitado ou colado do seletor do sistema/picker) já funciona sozinho
 * como texto normal — não precisa de nenhum tratamento aqui, o
 * navegador já renderiza.
 *
 * Usado só pra reação (pílula de emoji embaixo da mensagem) — ali o
 * conteúdo é sempre um único emoji, nunca markdown, então não precisa do
 * parser completo (`renderMessageContent` abaixo).
 *
 * `emojiByCode` deve conter URLs já absolutas (com o backendUrl na
 * frente), não os caminhos relativos que a API devolve.
 */
export function renderMessageText(
  text: string,
  emojiByCode: Map<string, { url: string }>,
  keyPrefix = ""
): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  CODE_REGEX.lastIndex = 0;
  while ((match = CODE_REGEX.exec(text)) !== null) {
    const [full, code] = match;
    const emoji = emojiByCode.get(code);
    if (!emoji) continue; // código desconhecido — deixa como texto normal, sem tratamento

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <img
        key={`${keyPrefix}emoji-${key++}`}
        className="chat-emoji"
        src={emoji.url}
        alt={full}
        title={full}
      />
    );
    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export function buildEmojiUrlMap(
  backendUrl: string,
  emojis: CustomEmoji[]
): Map<string, { url: string }> {
  const map = new Map<string, { url: string }>();
  for (const emoji of emojis) {
    map.set(emoji.code, { url: `${backendUrl}${emoji.url}` });
  }
  return map;
}

// Pontuação comum que costuma vir GRUDADA no fim de um link dentro de uma
// frase (ex: "olha isso: https://x.com.") mas não faz parte da URL.
const TRAILING_PUNCTUATION_REGEX = /[).,!?;:]+$/;

/**
 * Um token por vez, na ORDEM DE PRIORIDADE em que aparecem na alternância
 * (é assim que o regex resolve token que começam na mesma posição — ex:
 * ``` bate antes de ` na mesma posição, então bloco de código sempre
 * vence código inline). Cada grupo de captura corresponde a um tipo:
 *   1 = bloco de código ```...```
 *   2 = código inline `...`
 *   3 = negrito **...**
 *   4 = negrito __...__
 *   5 = itálico *...*
 *   6 = tachado ~~...~~
 *   7 = spoiler ||...||
 *   8 = código de emoji :codigo:
 *   9 = URL http(s)://...
 *
 * Propositalmente SEM itálico com underscore único (_assim_): a mesma
 * marcação colide direto com nome_de_variavel ou usuario_123, e sem uma
 * checagem de fronteira de palavra decente (que o motor de regex do JS
 * não faz de graça) o resultado seria itálico aparecendo onde não devia.
 * Fica documentado como limitação conhecida — ver PROJECT_CONTEXT.md.
 */
const INLINE_REGEX =
  /```([\s\S]+?)```|`([^`\n]+)`|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*]+?)\*|~~([^~]+?)~~|\|\|([^|]+?)\|\||:([a-z0-9_]{2,32}):|(https?:\/\/[^\s]+)/g;

function SpoilerSpan({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`chat-spoiler ${revealed ? "revealed" : ""}`}
      onClick={() => setRevealed(true)}
      title={revealed ? undefined : "Clique para revelar"}
    >
      {children}
    </span>
  );
}

/**
 * O parser de verdade: acha o próximo token (código/negrito/itálico/
 * tachado/spoiler/emoji/link), renderiza ele, e chama a si mesma de novo
 * no texto de dentro — é isso que permite `**negrito com :emoji: e
 * link**` funcionar. Bloco de código e código inline são a ÚNICA exceção:
 * o conteúdo deles é sempre texto puro, nunca processado de novo (senão
 * `` `**isso não devia virar negrito**` `` quebraria a ideia de "código é
 * literal").
 */
function renderInline(
  text: string,
  emojiByCode: Map<string, { url: string }>,
  keyPrefix: string
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  INLINE_REGEX.lastIndex = 0;
  while ((match = INLINE_REGEX.exec(text)) !== null) {
    const [full, codeBlock, inlineCode, boldStar, boldUnderscore, italic, strike, spoiler, emojiCode, url] =
      match;

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const k = `${keyPrefix}i${key++}`;

    if (codeBlock !== undefined) {
      nodes.push(
        <pre key={k} className="chat-codeblock">
          <code>{codeBlock}</code>
        </pre>
      );
    } else if (inlineCode !== undefined) {
      nodes.push(
        <code key={k} className="chat-inline-code">
          {inlineCode}
        </code>
      );
    } else if (boldStar !== undefined || boldUnderscore !== undefined) {
      nodes.push(<strong key={k}>{renderInline(boldStar ?? boldUnderscore, emojiByCode, `${k}-`)}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={k}>{renderInline(italic, emojiByCode, `${k}-`)}</em>);
    } else if (strike !== undefined) {
      nodes.push(<del key={k}>{renderInline(strike, emojiByCode, `${k}-`)}</del>);
    } else if (spoiler !== undefined) {
      nodes.push(
        <SpoilerSpan key={k}>{renderInline(spoiler, emojiByCode, `${k}-`)}</SpoilerSpan>
      );
    } else if (emojiCode !== undefined) {
      const emoji = emojiByCode.get(emojiCode);
      nodes.push(
        emoji ? (
          <img key={k} className="chat-emoji" src={emoji.url} alt={full} title={full} />
        ) : (
          full // código desconhecido — deixa como texto normal, sem tratamento
        )
      );
    } else if (url !== undefined) {
      const trailingMatch = url.match(TRAILING_PUNCTUATION_REGEX);
      const trailing = trailingMatch ? trailingMatch[0] : "";
      const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;
      nodes.push(
        <a key={k} href={cleanUrl} target="_blank" rel="noreferrer" className="chat-link">
          {cleanUrl}
        </a>
      );
      if (trailing) nodes.push(trailing);
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

/**
 * Renderizador completo do corpo de uma mensagem: markdown (negrito,
 * itálico, código inline e em bloco, tachado, spoiler), emoji personalizado
 * e link clicável — tudo numa passada só, podendo aninhar (negrito com
 * emoji dentro, link dentro de spoiler, etc.), exceto dentro de código,
 * que é sempre literal.
 */
export function renderMessageContent(text: string, emojiByCode: Map<string, { url: string }>): ReactNode[] {
  return renderInline(text, emojiByCode, "");
}
