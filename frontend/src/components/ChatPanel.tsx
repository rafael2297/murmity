import { useEffect, useRef, useState } from "react";
import { Smile, SmilePlus, Paperclip, Image as ImageIcon, X, ArrowDown, Pencil, Trash2, CornerUpLeft, FileText, Download } from "lucide-react";
import { useChatConnection, ChatAttachment } from "../ChatConnectionContext";
import { uploadAttachment, fetchLinkPreview, CustomEmoji, LinkPreview } from "../api";
import { renderMessageContent, renderMessageText, buildEmojiUrlMap } from "../emojiText";
import { extractFirstUrl } from "../links";
import { useConfirm } from "../ConfirmContext";
import EmojiPicker from "./EmojiPicker";
import GifPicker from "./GifPicker";
import YoutubeEmbed from "./YoutubeEmbed";
import LinkPreviewCard from "./LinkPreviewCard";
import "../chatAttachments.css";

interface Props {
  username: string;
  backendUrl: string;
  authToken: string;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

type FileKind = "image" | "audio" | "video" | "file";

// Mesmo limite do backend (attachments.ts) — avisa na hora, sem esperar o upload falhar.
const MAX_FILE_MB = 50;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_FILES_PER_SEND = 10;

interface PendingFile {
  id: string;
  file: File;
  kind: FileKind;
  previewUrl: string | null; // miniatura local (imagem/vídeo) — só existe até enviar/remover
}

function kindOfFile(file: File): FileKind {
  // SVG pode conter script, então trata como arquivo comum (só baixa).
  if (file.type === "image/svg+xml") return "file";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

// Baixa pelo app (fetch + blob) em vez de abrir uma janela: assim o arquivo
// salva com o NOME ORIGINAL e funciona igual no Electron e no navegador.
async function downloadFile(url: string, name: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

// Mensagens consecutivas da mesma pessoa em menos de 5 minutos ficam
// agrupadas (sem repetir avatar/nome), igual ao Discord.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export default function ChatPanel({ username, backendUrl, authToken }: Props) {
  const { messages, connected, sendMessage, editMessage, deleteMessage, toggleReaction, channels, currentTextChannelId, customEmojis } =
    useChatConnection();
  const currentChannelName = channels.find((c) => c.id === currentTextChannelId)?.name ?? "";
  const { confirm } = useConfirm();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; text: string } | null>(
    null
  );
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  // Guarda o ID da mensagem, não um booleano — é o que faz o seletor
  // "saber" em qual mensagem aplicar a reação escolhida (reusa o mesmo
  // EmojiPicker do composer, só muda pra quem o resultado vai).
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  // Arquivos escolhidos/arrastados, esperando você apertar "Enviar" (só então
  // sobem pro servidor e viram mensagem) — como no Discord.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
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
  const pendingFilesRef = useRef<PendingFile[]>([]);
  pendingFilesRef.current = pendingFiles;
  const addFilesRef = useRef<(files: File[]) => void>(() => {});

  // Libera as miniaturas locais ao sair do chat.
  useEffect(
    () => () => {
      pendingFilesRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    },
    []
  );

  // Arrastar arquivos pra QUALQUER lugar do app: mostra a área de soltar e,
  // ao soltar, os arquivos entram na fila de anexos. O preventDefault é
  // essencial: sem ele o navegador "abre" o arquivo e troca a tela do app.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) addFilesRef.current(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

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

  // Emoji personalizado agora vem do ChatConnectionContext (compartilhado
  // com o resto do app, atualizado ao vivo — ver comentário lá) em vez de
  // cada componente buscar sua própria cópia.

  // Sempre que uma mensagem nova tem um link, busca o preview dele (uma
  // vez só por URL, mesmo que apareça em várias mensagens). O backend
  // decide sozinho se é YouTube ou Open Graph genérico — aqui só importa
  // "tem link? busca." (ver fetchLinkPreview em api.ts).
  useEffect(() => {
    for (const m of messages) {
      const url = m.text ? extractFirstUrl(m.text) : null;
      if (!url || fetchedUrlsRef.current.has(url)) continue;
      fetchedUrlsRef.current.add(url);
      fetchLinkPreview(backendUrl, authToken, url).then((preview) => {
        if (!preview) return; // sem preview disponível — o link continua clicável normal
        setLinkPreviews((prev) => new Map(prev).set(url, preview));
      });
    }
  }, [messages, backendUrl, authToken]);

  const emojiByCode = buildEmojiUrlMap(backendUrl, customEmojis);

  async function send() {
    if (uploading) return;
    const text = draft;
    const files = pendingFiles;
    if (!text.trim() && files.length === 0) return;

    if (files.length === 0) {
      sendMessage(text, undefined, replyingTo?.id);
    } else {
      // Sobe os arquivos só agora. Se algum falhar, NADA é enviado e os
      // arquivos continuam na fila pra você tentar de novo.
      setUploading(true);
      setUploadError(null);
      try {
        const uploaded: ChatAttachment[] = [];
        for (const pending of files) {
          const result = await uploadAttachment(backendUrl, authToken, pending.kind, pending.file);
          uploaded.push({ url: result.url, type: result.type, name: result.name });
        }
        // O texto (e a resposta) vão junto com o 1º arquivo; cada arquivo
        // seguinte vira uma mensagem logo depois.
        uploaded.forEach((attachment, index) => {
          sendMessage(index === 0 ? text : "", attachment, index === 0 ? replyingTo?.id : undefined);
        });
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Erro ao enviar arquivo");
        setUploading(false);
        return;
      }
      setUploading(false);
      files.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      setPendingFiles([]);
    }

    setDraft("");
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

  async function handleDeleteMessage(id: string) {
    const confirmed = await confirm({
      title: "Apagar mensagem",
      message: "Apagar essa mensagem? Não tem como desfazer.",
      confirmLabel: "Apagar",
      danger: true,
    });
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
  }

  function handleSelectGif(gif: { url: string; width: number; height: number }) {
    // GIF já está hospedado pela Klipy — não precisa passar pelo nosso
    // backend, é só mandar a URL direto como anexo.
    setGifPickerOpen(false);
    sendMessage("", { url: gif.url, type: "gif" }, replyingTo?.id);
    setReplyingTo(null);
  }

  function openReactionPicker(messageId: string) {
    setEmojiPickerOpen(false); // só um seletor de emoji aberto por vez
    setReactionPickerFor(messageId);
  }

  function closeReactionPicker() {
    setReactionPickerFor(null);
  }

  function handleReactionSelectNative(emoji: string) {
    if (reactionPickerFor) toggleReaction(reactionPickerFor, emoji);
    closeReactionPicker();
  }

  function handleReactionSelectCustom(emoji: CustomEmoji) {
    // Mesmo formato ":codigo:" usado no texto da mensagem — é o que deixa
    // renderMessageText desenhar a reação como imagem, não como texto cru.
    if (reactionPickerFor) toggleReaction(reactionPickerFor, `:${emoji.code}:`);
    closeReactionPicker();
  }

  // Coloca arquivos na fila (botão de anexo, arrastar, colar). Nada sobe
  // pro servidor ainda — isso só acontece quando você aperta "Enviar".
  function addFiles(files: File[]) {
    const accepted: PendingFile[] = [];
    let error: string | null = null;
    const room = MAX_FILES_PER_SEND - pendingFilesRef.current.length;

    for (const file of files) {
      if (file.size === 0) {
        error = `"${file.name}" está vazio (ou é uma pasta).`;
      } else if (file.size > MAX_FILE_BYTES) {
        error = `"${file.name}" passa de ${MAX_FILE_MB} MB.`;
      } else if (accepted.length >= room) {
        error = `Máximo de ${MAX_FILES_PER_SEND} arquivos por mensagem.`;
      } else {
        const kind = kindOfFile(file);
        accepted.push({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
          file,
          kind,
          previewUrl: kind === "image" || kind === "video" ? URL.createObjectURL(file) : null,
        });
      }
    }

    setUploadError(error);
    if (accepted.length > 0) {
      setPendingFiles((prev) => [...prev, ...accepted]);
      textareaRef.current?.focus();
    }
  }
  addFilesRef.current = addFiles;

  function removePendingFile(id: string) {
    setPendingFiles((prev) => {
      const removed = prev.find((p) => p.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    setUploadError(null);
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (files.length > 0) addFiles(files);
  }

  // Ctrl+V com arquivo(s) copiado(s) — um print de tela ou arquivos do
  // Explorer — entra na fila igual ao botão de anexo. Se junto vier texto
  // (ex: copiado de um documento), deixa o paste de texto normal acontecer.
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0 || e.clipboardData?.getData("text/plain")) return;
    e.preventDefault();
    addFiles(files);
  }

  async function handleDownload(url: string, name: string) {
    try {
      await downloadFile(url, name);
    } catch {
      setUploadError("Não consegui baixar o arquivo.");
    }
  }

  return (
    <div className="chat-panel">
      {dragging && <div className="chat-drop-overlay">Solte para anexar ao chat</div>}
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

          const previewUrl = m.text ? extractFirstUrl(m.text) : null;
          const preview = previewUrl ? linkPreviews.get(previewUrl) : undefined;
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
                                  : repliedMessage.attachmentType === "video"
                                    ? "[vídeo]"
                                    : repliedMessage.attachmentType === "file"
                                      ? "[arquivo]"
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

                {preview?.type === "youtube" && previewUrl && (
                  <YoutubeEmbed preview={preview} sourceUrl={previewUrl} />
                )}
                {preview?.type === "generic" && <LinkPreviewCard preview={preview} />}
                {m.attachmentUrl && m.attachmentType === "audio" ? (
                  <audio
                    className="chat-attachment-audio"
                    controls
                    src={m.attachmentUrl.startsWith("http") ? m.attachmentUrl : `${backendUrl}${m.attachmentUrl}`}
                  />
                ) : m.attachmentUrl && m.attachmentType === "video" ? (
                  <video
                    className="chat-attachment-video"
                    controls
                    preload="metadata"
                    src={m.attachmentUrl.startsWith("http") ? m.attachmentUrl : `${backendUrl}${m.attachmentUrl}`}
                  />
                ) : m.attachmentUrl && m.attachmentType === "file" ? (
                  <button
                    className="chat-attachment-file"
                    title="Baixar arquivo"
                    onClick={() =>
                      handleDownload(
                        m.attachmentUrl!.startsWith("http") ? m.attachmentUrl! : `${backendUrl}${m.attachmentUrl}`,
                        m.attachmentName || "arquivo"
                      )
                    }
                  >
                    <FileText size={28} />
                    <span className="chat-attachment-file-name">{m.attachmentName || "arquivo"}</span>
                    <Download size={18} />
                  </button>
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

                {m.reactions && m.reactions.length > 0 && (
                  <div className="chat-reactions">
                    {m.reactions.map((r) => {
                      const mine = r.usernames.includes(username);
                      return (
                        <button
                          key={r.emoji}
                          className={`chat-reaction-badge ${mine ? "own" : ""}`}
                          onClick={() => toggleReaction(m.id, r.emoji)}
                          title={r.usernames.join(", ")}
                        >
                          {renderMessageText(r.emoji, emojiByCode, `${m.id}-react-`)}
                          <span className="chat-reaction-count">{r.usernames.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {editingId !== m.id && (
                <div className="chat-message-actions">
                  <button
                    className="icon-btn small"
                    onClick={() => openReactionPicker(m.id)}
                    title="Reagir"
                  >
                    <SmilePlus size={13} />
                  </button>
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

      {(pendingFiles.length > 0 || uploading || uploadError) && (
        <div className="chat-pending-files">
          {pendingFiles.map((p) => (
            <div key={p.id} className="chat-pending-file">
              <div className="chat-pending-file-thumb">
                {p.kind === "image" && p.previewUrl ? (
                  <img src={p.previewUrl} alt="" />
                ) : p.kind === "video" && p.previewUrl ? (
                  <video src={p.previewUrl} muted />
                ) : p.kind === "audio" ? (
                  <span>🎵</span>
                ) : (
                  <FileText size={22} />
                )}
              </div>
              <span className="chat-pending-file-name" title={p.file.name}>
                {p.file.name}
              </span>
              <button
                className="icon-btn small muted"
                onClick={() => removePendingFile(p.id)}
                disabled={uploading}
                title="Remover anexo"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {uploading && <span className="chat-pending-status">Enviando arquivos...</span>}
          {!uploading && uploadError && <span className="soundboard-error chat-pending-status">{uploadError}</span>}
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
          multiple
          hidden
          onChange={handleFilePicked}
        />
        <button
          className="icon-btn chat-emoji-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Anexar arquivos (ou arraste pra cá)"
        >
          <Paperclip size={20} />
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={connected ? `Mensagem para #${currentChannelName}` : "Reconectando ao chat..."}
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
        <button className="icon-btn chat-emoji-btn" onClick={() => { setReactionPickerFor(null); setEmojiPickerOpen(true); }} title="Emojis">
          <Smile size={20} />
        </button>
        <button onClick={send} disabled={(!draft.trim() && pendingFiles.length === 0) || !connected || uploading}>
          Enviar
        </button>
      </div>

      {emojiPickerOpen && (
        <EmojiPicker
          backendUrl={backendUrl}
          onClose={() => setEmojiPickerOpen(false)}
          onSelectNative={handleSelectNative}
          onSelectCustom={handleSelectCustom}
        />
      )}

      {reactionPickerFor && (
        <EmojiPicker
          backendUrl={backendUrl}
          onClose={closeReactionPicker}
          onSelectNative={handleReactionSelectNative}
          onSelectCustom={handleReactionSelectCustom}
        />
      )}

      {gifPickerOpen && (
        <GifPicker onClose={() => setGifPickerOpen(false)} onSelect={handleSelectGif} />
      )}
    </div>
  );
}
