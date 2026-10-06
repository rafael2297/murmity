/**
 * Preferência: ao compartilhar a tela, NÃO enviar o áudio do próprio Murmity
 * (vozes dos outros, soundboard...) junto com o áudio do sistema.
 *
 * Fica LIGADA por padrão (como o Discord). Desligar é o botão de emergência:
 * o compartilhamento volta ao modo antigo (áudio do sistema inteiro + os
 * outros mutados localmente pra ninguém se ouvir de volta).
 */
const KEY = "screenShareExcludeOwnAudio";

export function getExcludeOwnAudio(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setExcludeOwnAudio(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // sem localStorage: a preferência só não é lembrada
  }
}
