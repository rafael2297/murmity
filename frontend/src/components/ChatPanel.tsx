import { useEffect, useRef, useState } from "react";
import { Smile, Paperclip, Image as ImageIcon, X, ArrowDown, Pencil, Trash2, CornerUpLeft } from "lucide-react";
import { useChatConnection, ChatAttachment } from "../ChatConnectionContext";
import { fetchEmojis, uploadAttachment, fetchLinkPreview, CustomEmoji, LinkPreview } from "../api";
import { renderMessageContent, buildEmojiUrlMap } from "../emojiText";
import { extractFirstYoutubeUrl } from "../youtube";
import EmojiPicker from "./EmojiPicker";
import GifPicker from "./GifPicker";
import YoutubeEmbed from "./YoutubeEmbed";

interface Props {
  username: string;
  backendUrl: string;
  authToken: string;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Mensagens consecutivas da mesma pessoa em menos de 5 minutos ficam
// agrupadas (sem repetir avatar/nome), igual ao Discord.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export default function ChatPanel({ username, backendUrl, authToken }: Props) {
  const { messages, connected, sendMessage, editMessage, deleteMessage } = useChatConnection();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; text: string } | null>(
    null
  );
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [linkPreviews, setLinkPreviews] = useState<Map<string, LinkPreview>>(new Map());
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const fetchedUrlsRef = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messageElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const hasScrolledToInitialBottomRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function isNearBottom(): boolean {
    const el = messagesContainerRef.current;
    if (!el) return true;
    // Folga de 150px — não precisa estar exatamente no fim pra contar
    // como "acompanhando o chat".
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }

  useEffect(() => {
    if (messages.length === 0) return;

    if (!hasScrolledToInitialBottomRef.current) {
      // Primeira carga (histórico chegando pela primeira vez): pula
      // direto pro final SEM animação. Sem isso, dava pra ver o topo do
      // histórico por um instante antes do scroll suave "voar" lá pra
      // baixo — e piorava quanto mais mensagem tivesse no chat.
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
      hasScrolledToInitialBottomRef.current = true;
      return;
    }

    if (isNearBottom()) {
      // Já estava acompanhando o fim da conversa — acompanha a mensagem
      // nova também, com animação suave.
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setShowJumpToBottom(false);
    } else {
      // Rolou pra cima pra ler histórico — não puxa a pessoa de volta à
      // força, só avisa que chegou mensagem nova.
      setShowJumpToBottom(true);
    }
  }, [messages]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowJumpToBottom(false);
  }

  // Carrega os emojis personalizados uma vez, pra saber traduzir ":codigo:"
  // em imagem nas mensagens já recebidas. Se alguém adicionar um emoji
  // novo enquanto o chat já está aberto, só aparece depois de reabrir o
  // chat/app — aceitável por enquanto, não há um evento em tempo real
  // avisando sobre emojis novos.
  useEffect(() => {
    let cancelled = false;
    fetchEmojis(backendUrl, authToken)
      .then((list) => {
        if (!cancelled) setCustomEmojis(list);
      })
      .catch(() => {
        // Sem emoji personalizado carregado, as mensagens só não mostram
        // a imagem (o ":codigo:" some/vira imagem quebrada) — não trava
        // o chat por causa disso.
      });
    return () => {
      cancelled = true;
    };
  }, [backendUrl, authToken]);

  // Sempre que uma mensagem nova tem um link de YouTube, busca o preview
  // dele (uma vez só por URL, mesmo que apareça em várias mensagens).
  useEffect(() => {
    for (const m of messages) {
      const youtubeUrl = extractFirstYoutubeUrl(m.text);
      if (!youtubeUrl || fetchedUrlsRef.current.has(youtubeUrl)) continue;
      fetchedUrlsRef.current.add(youtubeUrl);
      fetchLinkPreview(backendUrl, authToken, youtubeUrl).then((preview) => {
        if (!preview) return; // sem preview disponível — o link continua clicável normal
        setLinkPreviews((prev) => new Map(prev).set(youtubeUrl, preview));
      });
    }
  }, [messages, backendUrl, authToken]);

  const emojiByCode = buildEmojiUrlMap(backendUrl, customEmojis);

  function send() {
    if (!draft.trim() && !pendingAttachment) return;
    sendMessage(draft, pendingAttachment ?? undefined, replyingTo?.id);
    setDraft("");
    setPendingAttachment(null);
    setReplyingTo(null);
    // Mandar uma mensagem é uma ação sua — faz sentido te levar de volta
    // pro final, mesmo que estivesse lendo histórico mais acima.
    scrollToBottom();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function startEdit(id: string, text: string) {
    setEditingId(id);
    setEditText(text);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  function saveEdit() {
    if (!editingId) return;
    editMessage(editingId, editText);
    setEditingId(null);
    setEditText("");
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  }

  function handleDeleteMessage(id: string) {
    const confirmed = window.confirm("Apagar essa mensagem? Não tem como desfazer.");
    if (!confirmed) return;
    deleteMessage(id);
  }

  function startReply(m: { id: string; username: string; text: string }) {
    setReplyingTo({ id: m.id, username: m.username, text: m.text });
    textareaRef.current?.focus();
  }

  function cancelReply() {
    setReplyingTo(null);
  }

  function jumpToMessage(id: string) {
    const el = messageElementsRef.current.get(id);
    if (!el) return; // mensagem original não está carregada (fora do histórico) — nada pra pular
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(id);
    setTimeout(() => {
      setHighlightedId((current) => (current === id ? null : current));
    }, 1500);
  }

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    if (!el) {
      setDraft((prev) => prev + text);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    // Devolve o foco e o cursor logo depois do que foi inserido.
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + text.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function handleSelectNative(emoji: string) {
    insertAtCursor(emoji);
  }

  function handleSelectCustom(emoji: CustomEmoji) {
    insertAtCursor(`:${emoji.code}:`);
    setCustomEmojis((prev) => (prev.some((e) => e.id === emoji.id) ? prev : [...prev, emoji]));
  }

  function handleSelectGif(gif: { url: string; width: number; height: number }) {
    // GIF já está hospedado pela Klipy — não precisa passar pelo nosso
    // backend, é só mandar a URL direto como anexo.
    setGifPickerOpen(false);
    sendMessage("", { url: gif.url, type: "gif" }, replyingTo?.id);
    setReplyingTo(null);
  }

  async function uploadPickedFile(file: File) {
    const kind = file.type.startsWith("audio/") ? "audio" : "image";
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded = await uploadAttachment(backendUrl, authToken, kind, file);
      setPendingAttachment({ url: uploaded.url, type: uploaded.type, name: uploaded.name });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    } finally {
      setUploading(false);
    }
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;
    await uploadPickedFile(file);
  }

  // Ctrl+V com uma imagem copiada (ex: print de tela) sobe ela igual ao
  // botão de anexo — sem isso, colar uma imagem no campo de texto não
  // fazia nada.
  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await uploadPickedFile(file);
        return;
      }
    }
    // Nada de imagem no clipboard — deixa o paste de texto normal acontecer.
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 && <p className="chat-empty">Nenhuma mensagem ainda.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped =
            prev &&
            prev.username === m.username &&
            m.timestamp - prev.timestamp < GROUP_WINDOW_MS &&
            !prev.attachmentUrl &&
            !m.attachmentUrl &&
            !m.replyToId; // resposta sempre quebra o agrupamento, pra deixar o contexto claro

          const youtubeUrl = m.text ? extractFirstYoutubeUrl(m.text) : null;
          const youtubePreview = youtubeUrl ? linkPreviews.get(youtubeUrl) : undefined;
          const repliedMessage = m.replyToId ? messages.find((msg) => msg.id === m.replyToId) : undefined;

          return (
            <div
              key={m.id}
              ref={(el) => {
                if (el) messageElementsRef.current.set(m.id, el);
                else messageElementsRef.current.delete(m.id);
              }}
              className={`chat-message-row ${grouped ? "grouped" : ""} ${
                highlightedId === m.id ? "highlighted" : ""
              }`}
            >
              {!grouped && (
                <div className="user-avatar" title={m.username}>
                  {m.username.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="chat-message-body">
                {m.replyToId && (
                  <button className="chat-reply-quote" onClick={() => jumpToMessage(m.replyToId!)}>
                    <CornerUpLeft size={12} />
                    {repliedMessage ? (
                      <>
                        <span className="chat-reply-quote-author">{repliedMessage.username}</span>
                        <span className="chat-reply-quote-text">
                          {repliedMessage.text
                            ? repliedMessage.text.slice(0, 80)
                            : repliedMessage.attachmentType === "gif"
                              ? "[GIF]"
                              : repliedMessage.attachmentType === "image"
                                ? "[imagem]"
                                : repliedMessage.attachmentType === "audio"
                                  ? "[áudio]"
                                  : ""}
                        </span>
                      </>
                    ) : (
                      <span className="chat-reply-quote-missing">Mensagem original não disponível</span>
                    )}
                  </button>
                )}

                {!grouped && (
                  <div className="chat-message-meta">
                    <span className={`chat-author ${m.username === username ? "own" : ""}`}>
                      {m.username}
                    </span>
                    <span className="chat-timestamp">{formatTime(m.timestamp)}</span>
                  </div>
                )}

                {editingId === m.id ? (
                  <div className="chat-edit-row">
                    <textarea
                      className="chat-edit-input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      autoFocus
                      rows={1}
                    />
                    <div className="chat-edit-actions">
                      <span>esc pra cancelar • enter pra salvar</span>
                      <button className="link-btn" onClick={cancelEdit}>
                        Cancelar
                      </button>
                      <button className="link-btn" onClick={saveEdit}>
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  m.text && (
                    <div className="chat-text-row">
                      <span className="chat-text">{renderMessageContent(m.text, emojiByCode)}</span>
                      {m.editedAt && <span className="chat-edited-tag">(editado)</span>}
                      {grouped && <span className="chat-timestamp-hover">{formatTime(m.timestamp)}</span>}
                    </div>
                  )
                )}

                {youtubeUrl && youtubePreview && (
                  <YoutubeEmbed preview={youtubePreview} sourceUrl={youtubeUrl} />
                )}
                {m.attachmentUrl && m.attachmentType === "audio" ? (
                  <audio
                    className="chat-attachment-audio"
                    controls
                    src={m.attachmentUrl.startsWith("http") ? m.attachmentUrl : `${backendUrl}${m.attachmentUrl}`}
                  />
                ) : m.attachmentUrl ? (
                  <a
                    href={m.attachmentUrl.startsWith("http") ? m.attachmentUrl : `${backendUrl}${m.attachmentUrl}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      className="chat-attachment-image"
                      src={m.attachmentUrl.startsWith("http") ? m.attachmentUrl : `${backendUrl}${m.attachmentUrl}`}
                      alt={m.attachmentName || (m.attachmentType === "gif" ? "GIF" : "imagem")}
                      loading="lazy"
                    />
                  </a>
                ) : null}
              </div>

              {editingId !== m.id && (
                <div className="chat-message-actions">
                  <button
                    className="icon-btn small"
                    onClick={() => startReply({ id: m.id, username: m.username, text: m.text })}
                    title="Responder"
                  >
                    <CornerUpLeft size={13} />
                  </button>
                  {m.username === username && (
                    <>
                      {m.text && (
                        <button
                          className="icon-btn small"
                          onClick={() => startEdit(m.id, m.text)}
                          title="Editar"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      <button
                        className="icon-btn small muted"
                        onClick={() => handleDeleteMessage(m.id)}
                        title="Apagar"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {showJumpToBottom && (
        <button className="chat-jump-to-bottom" onClick={scrollToBottom}>
          <ArrowDown size={14} /> Novas mensagens
        </button>
      )}

      {(pendingAttachment || uploading || uploadError) && (
        <div className="chat-pending-attachment">
          {uploading ? (
            <span className="device-select-empty">Enviando arquivo...</span>
          ) : uploadError ? (
            <span className="soundboard-error">{uploadError}</span>
          ) : pendingAttachment ? (
            <>
              {pendingAttachment.type === "audio" ? (
                <span>🎵 {pendingAttachment.name || "áudio"}</span>
              ) : (
                <img src={`${backendUrl}${pendingAttachment.url}`} alt="" />
              )}
              <button
                className="icon-btn small muted"
                onClick={() => setPendingAttachment(null)}
                title="Remover anexo"
              >
                <X size={14} />
              </button>
            </>
          ) : null}
        </div>
      )}

      {replyingTo && (
        <div className="chat-reply-bar">
          <CornerUpLeft size={14} />
          <span>
            Respondendo a <strong>{replyingTo.username}</strong>
            {replyingTo.text && `: ${replyingTo.text.slice(0, 60)}`}
          </span>
          <button className="icon-btn small muted" onClick={cancelReply} title="Cancelar resposta">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="chat-input-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,audio/*"
          hidden
          onChange={handleFilePicked}
        />
        <button
          className="icon-btn chat-emoji-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Anexar imagem ou áudio"
        >
          <Paperclip size={20} />
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={connected ? "Mensagem para #geral" : "Reconectando ao chat..."}
          rows={1}
        />
        <button
          className="icon-btn chat-emoji-btn chat-gif-btn"
          onClick={() => setGifPickerOpen(true)}
          title="GIF"
        >
          <ImageIcon size={18} />
          <span>GIF</span>
        </button>
        <button className="icon-btn chat-emoji-btn" onClick={() => setEmojiPickerOpen(true)} title="Emojis">
          <Smile size={20} />
        </button>
        <button onClick={send} disabled={(!draft.trim() && !pendingAttachment) || !connected || uploading}>
          Enviar
        </button>
      </div>

      {emojiPickerOpen && (
        <EmojiPicker
          backendUrl={backendUrl}
          authToken={authToken}
          onClose={() => setEmojiPickerOpen(false)}
          onSelectNative={handleSelectNative}
          onSelectCustom={handleSelectCustom}
        />
      )}

      {gifPickerOpen && (
        <GifPicker onClose={() => setGifPickerOpen(false)} onSelect={handleSelectGif} />
      )}
    </div>
  );
}
