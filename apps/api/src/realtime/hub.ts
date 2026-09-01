import type { WebSocket } from "ws";
import type { RealtimeEvent } from "./events";

type LiveSocket = WebSocket & {
  issueFlowAlive?: boolean;
  issueFlowApiTokenId?: number;
  issueFlowApiTokenExpiresAt?: number | undefined;
};

const OPEN = 1;
const MAX_CONNECTIONS_PER_TOKEN = 3;
const MAX_CONNECTIONS_PER_USER = 20;

export class RealtimeHub {
  private readonly clients = new Map<number, Set<LiveSocket>>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(heartbeatMs = 25_000) {
    this.heartbeat = setInterval(() => this.pingClients(), heartbeatMs);
    this.heartbeat.unref();
  }

  attach(userId: number, apiTokenId: number, socket: LiveSocket, apiTokenExpiresAt?: Date | null) {
    const sockets = this.clients.get(userId) ?? new Set<LiveSocket>();
    const tokenConnectionCount = [...sockets].filter((item) => item.issueFlowApiTokenId === apiTokenId).length;
    if (tokenConnectionCount >= MAX_CONNECTIONS_PER_TOKEN) {
      this.closeSocket(socket, 1013, "Too many realtime connections for this API token");
      return false;
    }
    if (sockets.size >= MAX_CONNECTIONS_PER_USER) {
      this.closeSocket(socket, 1013, "Too many realtime connections");
      return false;
    }
    if (apiTokenExpiresAt && apiTokenExpiresAt.getTime() <= Date.now()) {
      this.closeSocket(socket, 1008, "API token expired");
      return false;
    }
    sockets.add(socket);
    this.clients.set(userId, sockets);
    socket.issueFlowAlive = true;
    socket.issueFlowApiTokenId = apiTokenId;
    socket.issueFlowApiTokenExpiresAt = apiTokenExpiresAt?.getTime();
    socket.on("pong", () => { socket.issueFlowAlive = true; });
    const detach = () => this.detach(userId, socket);
    socket.once("close", detach);
    socket.on("error", detach);
    return this.send(userId, socket, { type: "hello", protocolVersion: 1, serverTime: new Date().toISOString() });
  }

  publish(userIds: Iterable<number>, event: RealtimeEvent) {
    let payload: string;
    try {
      payload = JSON.stringify(event);
    } catch {
      return;
    }
    for (const userId of new Set(userIds)) {
      for (const socket of this.clients.get(userId) ?? []) {
        this.sendPayload(userId, socket, payload);
      }
    }
  }

  disconnectToken(apiTokenId: number) {
    return this.disconnectWhere(
      (_userId, socket) => socket.issueFlowApiTokenId === apiTokenId,
      1008,
      "API token revoked",
    );
  }

  disconnectUser(userId: number) {
    return this.disconnectWhere(
      (connectedUserId) => connectedUserId === userId,
      1008,
      "User credentials revoked",
    );
  }

  disconnectAll() {
    return this.disconnectWhere(() => true, 1008, "Authentication state replaced");
  }

  disconnectExpired(now = Date.now()) {
    return this.disconnectWhere(
      (_userId, socket) => socket.issueFlowApiTokenExpiresAt !== undefined && socket.issueFlowApiTokenExpiresAt <= now,
      1008,
      "API token expired",
    );
  }

  connectionCount(userId?: number) {
    if (userId !== undefined) return this.clients.get(userId)?.size ?? 0;
    let total = 0;
    for (const sockets of this.clients.values()) total += sockets.size;
    return total;
  }

  close() {
    clearInterval(this.heartbeat);
    this.disconnectWhere(() => true, 1001, "Server shutting down");
  }

  private disconnectWhere(
    predicate: (userId: number, socket: LiveSocket) => boolean,
    code: number,
    reason: string,
  ) {
    const matches: Array<{ userId: number; socket: LiveSocket }> = [];
    for (const [userId, sockets] of this.clients) {
      for (const socket of sockets) if (predicate(userId, socket)) matches.push({ userId, socket });
    }
    for (const { userId, socket } of matches) {
      this.detach(userId, socket);
      this.closeSocket(socket, code, reason);
    }
    return matches.length;
  }

  private send(userId: number, socket: LiveSocket, event: RealtimeEvent) {
    let payload: string;
    try {
      payload = JSON.stringify(event);
    } catch {
      this.discard(userId, socket);
      return false;
    }
    return this.sendPayload(userId, socket, payload);
  }

  private sendPayload(userId: number, socket: LiveSocket, payload: string) {
    if (socket.readyState !== OPEN) {
      this.discard(userId, socket);
      return false;
    }
    try {
      socket.send(payload, (error?: Error) => {
        if (error) this.discard(userId, socket);
      });
      return true;
    } catch {
      this.discard(userId, socket);
      return false;
    }
  }

  private ping(userId: number, socket: LiveSocket) {
    if (socket.readyState !== OPEN) {
      this.discard(userId, socket);
      return false;
    }
    try {
      socket.ping(undefined, undefined, (error?: Error) => {
        if (error) this.discard(userId, socket);
      });
      return true;
    } catch {
      this.discard(userId, socket);
      return false;
    }
  }

  private closeSocket(socket: LiveSocket, code: number, reason: string) {
    try {
      socket.close(code, reason);
    } catch {
      try { socket.terminate(); } catch { /* The broken connection is already unreachable. */ }
    }
  }

  private discard(userId: number, socket: LiveSocket) {
    this.detach(userId, socket);
    try { socket.terminate(); } catch { /* A broken connection must not affect other clients. */ }
  }

  private detach(userId: number, socket: LiveSocket) {
    const sockets = this.clients.get(userId);
    sockets?.delete(socket);
    if (!sockets?.size) this.clients.delete(userId);
  }

  private pingClients() {
    this.disconnectExpired();
    for (const [userId, sockets] of this.clients) {
      for (const socket of sockets) {
        if (socket.issueFlowAlive === false) {
          this.discard(userId, socket);
          continue;
        }
        socket.issueFlowAlive = false;
        if (!this.send(userId, socket, { type: "ping", sentAt: new Date().toISOString() })) continue;
        this.ping(userId, socket);
      }
    }
  }
}
