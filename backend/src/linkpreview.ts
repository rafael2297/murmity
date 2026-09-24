import { Router } from "express";
import { requireAuth } from "./middleware";

const router = Router();

const YOUTUBE_PATTERN =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

interface YoutubeOEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

// Só lê os primeiros N bytes da resposta — tag Open Graph sempre fica no
// <head>, bem no começo do HTML, então não precisa (e não deveria) baixar
// a página inteira só pra achar um <meta>. Também limita o estrago de um
// site que decida mandar uma resposta gigante de propósito.
const MAX_HTML_BYTES = 300 * 1024; // 300 KB
const FETCH_TIMEOUT_MS = 5000;

/**
 * Guarda-corpo BÁSICO contra SSRF: recusa host óbvio de rede interna
 * (localhost, IP privado/link-local). Não resolve DNS pra checar o IP de
 * verdade — um domínio que aponta pra um IP interno (DNS rebinding)
 * passaria batido. É uma defesa de "não deixar na cara", não uma
 * blindagem completa; proporcional ao tamanho do app (grupo de amigos,
 * não é produto exposto na internet pra qualquer um mandar link).
 */
function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // tira colchetes de IPv6 literal
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;

  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local, inclui metadata de nuvem (169.254.169.254)
    if (a === 0) return true; // 0.0.0.0/8
  }
  return false;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Extrai o content= de uma <meta property="..."> (ou name="...", usado
 * pelo fallback de description). Aceita property/content em qualquer
 * ordem dentro da tag e aspas simples ou duplas — cobre a esmagadora
 * maioria dos sites reais sem precisar de um parser de HTML de verdade
 * (biblioteca que exigiria acesso à internet pra instalar, que o
 * container não tem).
 */
function extractMetaContent(html: string, attr: "property" | "name", key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtmlEntities(match[1]).trim();
  }
  return null;
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).trim() : null;
}

/**
 * GET /link-preview?url=...
 *
 * YouTube usa o oEmbed oficial deles (não precisa de chave de API).
 * Qualquer outro site cai no fallback genérico: baixa o começo do HTML e
 * lê as tags Open Graph (og:title/og:description/og:image/og:site_name),
 * com <title> como reserva se o site não tiver Open Graph nenhum. Se não
 * achar nada aproveitável, devolve 404 — o link continua funcionando no
 * chat normalmente, só que como link clicável simples, sem card.
 *
 * Por que isso precisa passar pelo backend em vez do frontend chamar
 * direto: nem oEmbed do YouTube nem a maioria dos sites mandam cabeçalho
 * de CORS, então o navegador bloqueia um fetch direto de dentro do app.
 */
router.get("/", requireAuth, async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";

  const youtubeMatch = url.match(YOUTUBE_PATTERN);
  if (youtubeMatch) {
    await handleYoutubePreview(youtubeMatch[1], res);
    return;
  }

  await handleGenericPreview(url, res);
});

async function handleYoutubePreview(videoId: string, res: import("express").Response) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;
    const oembedRes = await fetch(oembedUrl);
    if (!oembedRes.ok) {
      res.status(404).json({ error: "Vídeo não encontrado, privado ou removido" });
      return;
    }
    const data = (await oembedRes.json()) as YoutubeOEmbedResponse;
    res.json({
      type: "youtube",
      videoId,
      title: data.title ?? "",
      authorName: data.author_name ?? "",
      thumbnailUrl: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  } catch (err) {
    console.error("Erro buscando preview do YouTube:", err);
    res.status(502).json({ error: "Não foi possível buscar informações do vídeo agora" });
  }
}

async function handleGenericPreview(rawUrl: string, res: import("express").Response) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "URL inválida" });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ error: "Só links http/https têm preview" });
    return;
  }
  if (isBlockedHost(parsed.hostname)) {
    res.status(400).json({ error: "Esse endereço não pode ser usado pra preview" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const pageRes = await fetch(parsed.href, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Alguns sites só devolvem as tags Open Graph pra requisições que
        // parecem vir de um crawler/bot — um browser real receberia a
        // versão renderizada por JS, que aqui a gente não executa mesmo.
        "User-Agent": "Mozilla/5.0 (compatible; MurmityLinkPreview/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!pageRes.ok || !pageRes.body) {
      res.status(404).json({ error: "Sem preview disponível pra esse link" });
      return;
    }
    const contentType = pageRes.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      res.status(404).json({ error: "Sem preview disponível pra esse link" });
      return;
    }

    // Lê só até MAX_HTML_BYTES em vez de pageRes.text() (que baixaria a
    // resposta inteira antes de decidir que já tem o suficiente).
    const reader = pageRes.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks as Uint8Array[]).toString("utf-8");

    const title = extractMetaContent(html, "property", "og:title") ?? extractTitleTag(html);
    const description =
      extractMetaContent(html, "property", "og:description") ??
      extractMetaContent(html, "name", "description");
    const siteName = extractMetaContent(html, "property", "og:site_name") ?? parsed.hostname;
    let imageUrl = extractMetaContent(html, "property", "og:image");
    if (imageUrl) {
      try {
        // og:image às vezes vem como caminho relativo ("/img/capa.png")
        // em vez de URL completa — resolve contra a página de origem.
        imageUrl = new URL(imageUrl, parsed.href).href;
      } catch {
        imageUrl = null;
      }
    }

    if (!title && !description && !imageUrl) {
      res.status(404).json({ error: "Sem preview disponível pra esse link" });
      return;
    }

    res.json({
      type: "generic",
      url: parsed.href,
      title: title ?? parsed.hostname,
      description: description ?? "",
      imageUrl: imageUrl ?? null,
      siteName,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      res.status(504).json({ error: "O site demorou demais pra responder" });
      return;
    }
    console.error("Erro buscando preview genérico:", err);
    res.status(502).json({ error: "Não foi possível buscar informações desse link agora" });
  } finally {
    clearTimeout(timeout);
  }
}

export default router;
