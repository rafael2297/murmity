import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { notify } from "./notifications";
import {
  Channel,
  CustomEmoji,
  fetchChannels,
  createChannel as apiCreateChannel,
  deleteChannel as apiDeleteChannel,
  fetchEmojis,
  uploadEmoji as apiUploadEmoji,
  deleteEmoji as apiDeleteEmoji,
} from "./api";

export type AttachmentType = "image" | "audio" | "gif";

export interface ChatAttachment {
  url: string;
  type: AttachmentType;
  name?: string;
}

export interface MessageReaction {
  emoji: string;
  usernames: string[];
}

interface ChatMessage {
  id: string;
  channelId: string;
  username: string;
  text: string;
  timestamp: number;
  attachmentUrl?: string | null;
  attachmentType?: AttachmentType | null;
  attachmentName?: string | null;
  editedAt?: number | null;
  replyToId?: string | null;
  reactions?: MessageReaction[];
}

interface ChatConnectionValue {
  messages: ChatMessage[];
  onlineUsers: string[];
  connected: boolean;
  sendMessage: (text: string, attachment?: ChatAttachment, replyToId?: string) => void;
  editMessage: (id: string, text: string) => void;
  deleteMessage: (id: string) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  // Canais: ver comentário grande logo acima do Provider pra entender por
  // que isso mora aqui junto do chat, em vez de num contexto separado.
  channels: Channel[];
  currentTextChannelId: string | null;
  switchTextChannel: (channelId: string) => void;
  createChannel: (name: string, type: "text" | "voice") => Promise<void>;
  deleteChannel: (id: string) => Promise<void>;
  // Emoji personalizado: mesma lógica de "fetch uma vez + atualização ao
  // vivo por WebSocket" dos canais, pelo mesmo motivo (compartilha a
  // mesma conexão) — ver comentário grande acima do Provider.
  customEmojis: CustomEmoji[];
  uploadEmoji: (code: string, file: File) => Promise<void>;
  deleteEmoji: (id: string) => Promise<void>;
}

const ChatConnectionContext = createContext<ChatConnectionValue | null>(null);

function toWsUrl(backendUrl: string, token: string) {
  const wsBase = backendUrl.replace(/^http/, "ws");
  return `${wsBase}/ws/chat?token=${encodeURIComponent(token)}`;
}

interface ProviderProps {
  backendUrl: string;
  authToken: string;
  username: string;
  children: ReactNode;
}

/**
 * Fica montado no Workspace inteiro (não dentro do ChatPanel), pra
 * conexão sobreviver independente de você estar vendo o chat, a call, ou
 * trocando de tela — é o que permite a lista de "quem está online"
 * funcionar direito, sem piscar.
 *
 * Também é dono da LISTA DE CANAIS (texto e voz) e de qual canal de texto
 * está selecionado agora, mesmo não sendo estritamente "sobre chat" —
 * moram aqui porque compartilham o mesmo WebSocket (evita abrir uma
 * segunda conexão só pra "channel_created"/"channel_deleted") e porque
 * trocar de canal de texto é, na prática, reconfigurar esse mesmo chat
 * (histórico diferente, mensagens diferentes chegando).
 */
export function ChatConnectionProvider({ backendUrl, authToken, username, children }: ProviderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [currentTextChannelId, setCurrentTextChannelId] = useState<string | null>(null);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Refs pra ler o valor mais recente de dentro de callbacks assíncronos
  // (ws.onmessage, o polling de channels) sem precisar recriar a conexão
  // toda vez que esses valores mudam.
  const currentTextChannelIdRef = useRef<string | null>(null);
  const lastJoinedChannelRef = useRef<string | null>(null);
  useEffect(() => {
    currentTextChannelIdRef.current = currentTextChannelId;
  }, [currentTextChannelId]);

  // Busca a lista de canais uma vez, via REST — atualizações depois disso
  // chegam ao vivo pelo WebSocket (channel_created/channel_deleted, ver
  // abaixo), não por um novo fetch.
  useEffect(() => {
    let cancelled = false;
    fetchChannels(backendUrl, authToken)
      .then((list) => {
        if (cancelled) return;
        setChannels(list);
        // Só define o canal padrão na primeira carga (currentTextChannelId
        // ainda null) — depois disso, quem decide é switchTextChannel ou a
        // realocação automática quando o canal atual é apagado.
        setCurrentTextChannelId((prev) => prev ?? list.find((c) => c.type === "text")?.id ?? null);
      })
      .catch((err) => {
        console.warn("Não foi possível carregar a lista de canais:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [backendUrl, authToken]);

  // Mesma ideia pro emoji personalizado: busca uma vez, atualiza ao vivo
  // depois (emoji_created/emoji_deleted). Antes disso, cada tela que
  // precisava da lista (ChatPanel, EmojiPicker, EmojiManager) buscava a
  // sua própria cópia, e um emoji novo só aparecia pra quem reabrisse o
  // chat — agora as três leem daqui.
  useEffect(() => {
    let cancelled = false;
    fetchEmojis(backendUrl, authToken)
      .then((list) => {
        if (!cancelled) setCustomEmojis(list);
      })
      .catch((err) => {
        console.warn("Não foi possível carregar a lista de emojis:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [backendUrl, authToken]);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function sendJoinChannelIfNeeded() {
      const ws = wsRef.current;
      const channelId = currentTextChannelIdRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !channelId) return;
      if (lastJoinedChannelRef.current === channelId) return; // já pedimos esse mesmo canal, evita spam
      lastJoinedChannelRef.current = channelId;
      ws.send(JSON.stringify({ type: "join_channel", channelId }));
    }

    function connect() {
      const ws = new WebSocket(toWsUrl(backendUrl, authToken));
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        lastJoinedChannelRef.current = null; // reconectou — precisa re-anunciar o canal atual
        sendJoinChannelIfNeeded();
      };

      ws.onclose = () => {
        setConnected(false);
        setOnlineUsers([]);
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        attempt += 1;
        retryTimeout = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "history") {
          // Só aplica se ainda for o canal que a pessoa está vendo AGORA —
          // troca rápida de canal pode fazer um "history" antigo chegar
          // depois da troca (ver switchTextChannel).
          if (data.channelId === currentTextChannelIdRef.current) {
            setMessages(data.messages);
          }
        } else if (data.type === "message") {
          // Servidor só entrega "message" pra quem está com aquele canal
          // aberto, mas confere de novo aqui — sem custo, e fecha
          // qualquer brecha de corrida na troca de canal.
          if (data.message.channelId !== currentTextChannelIdRef.current) return;
          setMessages((prev) => [...prev, data.message]);
          if (data.message.username !== username) {
            const preview =
              data.message.text ||
              (data.message.attachmentType === "gif"
                ? "[GIF]"
                : data.message.attachmentType === "image"
                  ? "[imagem]"
                  : data.message.attachmentType === "audio"
                    ? "[áudio]"
                    : "");
            notify(data.message.username, preview);
          }
        } else if (data.type === "presence") {
          setOnlineUsers(data.online);
        } else if (data.type === "message_edited") {
          setMessages((prev) =>
            prev.map((m) => (m.id === data.id ? { ...m, text: data.text, editedAt: data.editedAt } : m))
          );
        } else if (data.type === "message_deleted") {
          setMessages((prev) => prev.filter((m) => m.id !== data.id));
        } else if (data.type === "message_reactions") {
          setMessages((prev) =>
            prev.map((m) => (m.id === data.messageId ? { ...m, reactions: data.reactions } : m))
          );
        } else if (data.type === "channel_created") {
          setChannels((prev) => [...prev, data.channel]);
        } else if (data.type === "channel_deleted") {
          setChannels((prev) => {
            const next = prev.filter((c) => c.id !== data.id);
            // Se o canal apagado era o que a pessoa estava vendo, pula pro
            // primeiro canal de texto que sobrou — sem isso ela ficaria
            // olhando pra um canal que não existe mais.
            if (data.id === currentTextChannelIdRef.current) {
              const fallback = next.find((c) => c.type === "text");
              setCurrentTextChannelId(fallback?.id ?? null);
              setMessages([]);
            }
            return next;
          });
        } else if (data.type === "emoji_created") {
          setCustomEmojis((prev) => [...prev, data.emoji]);
        } else if (data.type === "emoji_deleted") {
          setCustomEmojis((prev) => prev.filter((e) => e.id !== data.id));
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, authToken, username]);

  // Roda toda vez que o canal de texto selecionado muda (troca manual OU
  // realocação automática após apagar canal) — manda o "join_channel" e
  // já limpa a tela pra não mostrar mensagem do canal anterior enquanto
  // o histórico novo não chega.
  useEffect(() => {
    if (!currentTextChannelId) return;
    setMessages([]);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && lastJoinedChannelRef.current !== currentTextChannelId) {
      lastJoinedChannelRef.current = currentTextChannelId;
      ws.send(JSON.stringify({ type: "join_channel", channelId: currentTextChannelId }));
    }
    // Se o socket ainda não estiver aberto, o próprio ws.onopen acima cuida
    // de mandar o join_channel assim que conectar.
  }, [currentTextChannelId]);

  function switchTextChannel(channelId: string) {
    if (channelId === currentTextChannelId) return;
    setCurrentTextChannelId(channelId);
  }

  async function createChannelAndWait(name: string, type: "text" | "voice") {
    // A lista de canais de todo mundo (inclusive quem chamou isso) é
    // atualizada pelo evento "channel_created" que o próprio servidor
    // devolve por WebSocket — não precisa fazer nada com o retorno aqui.
    await apiCreateChannel(backendUrl, authToken, name, type);
  }

  async function deleteChannelAndWait(id: string) {
    await apiDeleteChannel(backendUrl, authToken, id);
  }

  async function uploadEmojiAndWait(code: string, file: File) {
    // A lista de todo mundo (inclusive quem chamou isso) é atualizada
    // pelo evento "emoji_created" que o servidor devolve por WebSocket —
    // mesmo raciocínio de createChannel acima.
    await apiUploadEmoji(backendUrl, authToken, code, file);
  }

  async function deleteEmojiAndWait(id: string) {
    await apiDeleteEmoji(backendUrl, authToken, id);
  }

  function sendMessage(text: string, attachment?: ChatAttachment, replyToId?: string) {
    const clean = text.trim();
    // Precisa ter texto OU anexo — as duas coisas vazias não manda nada
    // (mesma regra do backend, ver chat.ts).
    if (
      (!clean && !attachment) ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN ||
      !currentTextChannelId
    ) {
      return;
    }
    wsRef.current.send(
      JSON.stringify({
        type: "send",
        channelId: currentTextChannelId,
        text: clean,
        attachmentUrl: attachment?.url,
        attachmentType: attachment?.type,
        attachmentName: attachment?.name,
        replyToId,
      })
    );
  }

  function editMessage(id: string, text: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "edit", id, text: text.trim() }));
  }

  function deleteMessage(id: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "delete", id }));
  }

  // Mesmo protocolo pra reagir OU tirar a reação — o servidor decide qual
  // dos dois é, com base no que já existe no banco pra essa combinação de
  // mensagem/pessoa/emoji (ver handleReact em chat.ts).
  function toggleReaction(messageId: string, emoji: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "react", messageId, emoji }));
  }

  return (
    <ChatConnectionContext.Provider
      value={{
        messages,
        onlineUsers,
        connected,
        sendMessage,
        editMessage,
        deleteMessage,
        toggleReaction,
        channels,
        currentTextChannelId,
        switchTextChannel,
        createChannel: createChannelAndWait,
        deleteChannel: deleteChannelAndWait,
        customEmojis,
        uploadEmoji: uploadEmojiAndWait,
        deleteEmoji: deleteEmojiAndWait,
      }}
    >
      {children}
    </ChatConnectionContext.Provider>
  );
}

export function useChatConnection(): ChatConnectionValue {
  const ctx = useContext(ChatConnectionContext);
  if (!ctx) {
    throw new Error("useChatConnection precisa ser usado dentro de um ChatConnectionProvider");
  }
  return ctx;
}
