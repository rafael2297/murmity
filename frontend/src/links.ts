const URL_REGEX = /https?:\/\/[^\s]+/;
// Pontuação comum que costuma vir GRUDADA no fim de um link dentro de uma
// frase (ex: "olha isso: https://x.com.") mas não faz parte da URL de
// verdade — mesma lista usada pra renderizar link clicável no texto (ver
// emojiText.tsx), repetida aqui porque são dois arquivos com
// responsabilidade diferente (achar vs. desenhar).
const TRAILING_PUNCTUATION_REGEX = /[).,!?;:]+$/;

/** Primeira URL http(s) encontrada no texto (sem pontuação de frase grudada no fim), ou null. */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  if (!match) return null;
  const trailing = match[0].match(TRAILING_PUNCTUATION_REGEX);
  return trailing ? match[0].slice(0, -trailing[0].length) : match[0];
}
