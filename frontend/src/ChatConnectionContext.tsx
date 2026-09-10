import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { notify } from "./notifications";

export type AttachmentType = "image" | "audio" | "gif";

export interface ChatAttachment {
  url: string;
  type: AttachmentType;
  name?: string;
}

interface ChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  attachmentUrl?: string | null;
  attachmentType?: AttachmentType | null;
  attachmentName?: string | null;
  editedAt?: number | null;
  replyToId?: string | null;
}

interface ChatConnectionValue {
  messages: ChatMessage[];
  onlineUsers: string[];
  connected: boolean;
  sendMessage: (text: string, attachment?: ChatAttachment, replyToId?: string) => void;
  editMessage: (id: string, text: string) => void;
  deleteMessage: (id: string) => void;
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
 */
export function ChatConnectionProvider({ backendUrl, authToken, username, children }: ProviderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function connect() {
      const ws = new WebSocket(toWsUrl(backendUrl, authToken));
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
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
          setMessages(data.messages);
        } else if (data.type === "message") {
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
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      wsRef.current?.close();
    };
  }, [backendUrl, authToken, username]);

  function sendMessage(text: string, attachment?: ChatAttachment, replyToId?: string) {
    const clean = text.trim();
    // Precisa ter texto OU anexo — as duas coisas vazias não manda nada
    // (mesma regra do backend, ver chat.ts).
    if ((!clean && !attachment) || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    wsRef.current.send(
      JSON.stringify({
        type: "send",
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

  return (
    <ChatConnectionContext.Provider
      value={{ messages, onlineUsers, connected, sendMessage, editMessage, deleteMessage }}
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
