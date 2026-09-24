import { Router } from "express";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { requireAuth, AuthedRequest } from "./middleware";

const router = Router();

function toHttpUrl(url: string): string {
  if (url.startsWith("wss://")) return "https://" + url.slice(6);
  if (url.startsWith("ws://")) return "http://" + url.slice(5);
  return url;
}

const roomService = new RoomServiceClient(
  toHttpUrl(process.env.LIVEKIT_URL as string),
  process.env.LIVEKIT_API_KEY as string,
  process.env.LIVEKIT_API_SECRET as string
);

/**
 * POST /rooms/:roomName/join-token
 *
 * Gera um token de acesso ao LiveKit para o usuário autenticado entrar
 * na sala indicada. Substitui o generate-token.js manual da Etapa 1.
 *
 * TODO (fase futura — P6/P7 do roadmap): validar se o usuário tem
 * permissão nesse canal/grupo específico (roles, membros). Por enquanto,
 * qualquer usuário autenticado pode entrar em qualquer sala — aceitável
 * para o tamanho do grupo atual (uso privado entre amigos), revisitar
 * quando "grupos/canais" (P6) e "cargos/permissões" (P7) entrarem.
 */
router.post("/:roomName/join-token", requireAuth, async (req: AuthedRequest, res) => {
  const { roomName } = req.params;
  const identity = req.user!.username;

  if (!roomName || roomName.trim().length === 0) {
    res.status(400).json({ error: "nome da sala é obrigatório" });
    return;
  }

  const apiKey = process.env.LIVEKIT_API_KEY as string;
  const apiSecret = process.env.LIVEKIT_API_SECRET as string;

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    // Curta duração — token só serve pra entrar na call agora, não fica
    // valendo pra sempre (item de risco #5 do PROJECT_CONTEXT.md).
    ttl: "10m",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // Necessário pro participante conseguir usar localParticipant.setAttributes
    // no cliente (usado pelo ensurdecer, pra publicar esse estado pros outros
    // verem o ícone ao lado do nome). Sem isso o LiveKit rejeita a chamada
    // com NOT_ALLOWED.
    canUpdateOwnMetadata: true,
  });

  const token = await at.toJwt();

  res.json({
    token,
    url: process.env.LIVEKIT_URL,
    identity,
    room: roomName,
  });
});

/**
 * GET /rooms/:roomName/participants
 *
 * Lista quem está na sala AGORA no LiveKit, sem precisar entrar de
 * verdade — pergunta direto pro LiveKit Server (RoomServiceClient, API de
 * servidor, diferente do AccessToken que é pro cliente). Usado pra
 * mostrar "quem está na call" mesmo pra quem ainda não entrou.
 */
router.get("/:roomName/participants", requireAuth, async (req: AuthedRequest, res) => {
  const { roomName } = req.params;
  try {
    const participants = await roomService.listParticipants(roomName);
    res.json({ participants: participants.map((p) => ({ identity: p.identity })) });
  } catch {
    // Sala ainda não existe no LiveKit (ninguém entrou nela ainda) —
    // não é erro de verdade, só significa "ninguém na call".
    res.json({ participants: [] });
  }
});

export default router;
