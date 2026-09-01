import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeHub } from "./hub";

type SocketCallback = (error?: Error) => void;

class FakeSocket extends EventEmitter {
  readyState = 1;
  issueFlowAlive = true;
  send = vi.fn((_payload: string, callback?: SocketCallback) => callback?.());
  ping = vi.fn((_data?: unknown, _mask?: boolean, callback?: SocketCallback) => callback?.());
  close = vi.fn(() => { this.readyState = 3; this.emit("close"); });
  terminate = vi.fn(() => { this.readyState = 3; });
}

const issueChanged = {
  type: "issue.changed" as const,
  issueId: 42,
  updatedAt: "2026-08-31T09:00:00.000Z",
  actorId: 7,
};

describe("RealtimeHub failure isolation", () => {
  const hubs: RealtimeHub[] = [];
  const createHub = () => {
    const hub = new RealtimeHub(60_000);
    hubs.push(hub);
    return hub;
  };
  const attach = (hub: RealtimeHub, userId: number, socket: FakeSocket, apiTokenId = userId) => hub.attach(userId, apiTokenId, socket as never);

  afterEach(() => {
    for (const hub of hubs.splice(0)) hub.close();
    vi.useRealTimers();
  });

  it("rejects a connection cleanly when the hello send throws", () => {
    const hub = createHub();
    const broken = new FakeSocket();
    broken.send.mockImplementationOnce(() => { throw new Error("hello failed"); });
    let attached: boolean | undefined;

    expect(() => { attached = attach(hub, 1, broken); }).not.toThrow();
    expect(attached).toBe(false);
    expect(broken.terminate).toHaveBeenCalledOnce();
    expect(hub.connectionCount(1)).toBe(0);
  });

  it("continues broadcasting when one socket.send throws", () => {
    const hub = createHub();
    const broken = new FakeSocket();
    const healthy = new FakeSocket();
    expect(attach(hub, 1, broken)).toBe(true);
    expect(attach(hub, 1, healthy)).toBe(true);
    broken.send.mockImplementationOnce(() => { throw new Error("send failed"); });
    healthy.send.mockClear();

    expect(() => hub.publish([1], issueChanged)).not.toThrow();

    expect(broken.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenCalledOnce();
    expect(JSON.parse(String(healthy.send.mock.calls[0]?.[0]))).toEqual(issueChanged);
    expect(hub.connectionCount(1)).toBe(1);
  });

  it("removes only the failed socket when send reports an asynchronous error", () => {
    const hub = createHub();
    const broken = new FakeSocket();
    const healthy = new FakeSocket();
    attach(hub, 1, broken);
    attach(hub, 1, healthy);
    broken.send.mockImplementationOnce((_payload, callback) => callback?.(new Error("write failed")));
    healthy.send.mockClear();

    expect(() => hub.publish([1], issueChanged)).not.toThrow();

    expect(broken.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenCalledOnce();
    expect(hub.connectionCount(1)).toBe(1);
  });

  it("continues heartbeats when one socket.ping throws", () => {
    const hub = createHub();
    const broken = new FakeSocket();
    const healthy = new FakeSocket();
    attach(hub, 1, broken);
    attach(hub, 1, healthy);
    broken.ping.mockImplementationOnce(() => { throw new Error("ping failed"); });
    healthy.send.mockClear();
    healthy.ping.mockClear();

    expect(() => (hub as unknown as { pingClients(): void }).pingClients()).not.toThrow();

    expect(broken.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenCalledOnce();
    expect(healthy.ping).toHaveBeenCalledOnce();
    expect(hub.connectionCount(1)).toBe(1);
  });

  it("removes only the failed socket when ping reports an asynchronous error", () => {
    const hub = createHub();
    const broken = new FakeSocket();
    const healthy = new FakeSocket();
    attach(hub, 1, broken);
    attach(hub, 1, healthy);
    broken.ping.mockImplementationOnce((_data, _mask, callback) => callback?.(new Error("ping write failed")));
    healthy.ping.mockClear();

    expect(() => (hub as unknown as { pingClients(): void }).pingClients()).not.toThrow();

    expect(broken.terminate).toHaveBeenCalledOnce();
    expect(healthy.ping).toHaveBeenCalledOnce();
    expect(hub.connectionCount(1)).toBe(1);
  });

  it("disconnects only connections authenticated by the revoked API token", () => {
    const hub = createHub();
    const revoked = new FakeSocket();
    const revokedSecondConnection = new FakeSocket();
    const sameUserOtherToken = new FakeSocket();
    const otherUser = new FakeSocket();
    attach(hub, 1, revoked, 101);
    attach(hub, 1, revokedSecondConnection, 101);
    attach(hub, 1, sameUserOtherToken, 102);
    attach(hub, 2, otherUser, 201);

    expect(hub.disconnectToken(101)).toBe(2);

    expect(revoked.close).toHaveBeenCalledWith(1008, "API token revoked");
    expect(revokedSecondConnection.close).toHaveBeenCalledWith(1008, "API token revoked");
    expect(sameUserOtherToken.close).not.toHaveBeenCalled();
    expect(otherUser.close).not.toHaveBeenCalled();
    expect(hub.connectionCount(1)).toBe(1);
    expect(hub.connectionCount(2)).toBe(1);
  });

  it("disconnects every token for one user without affecting other users", () => {
    const hub = createHub();
    const first = new FakeSocket();
    const second = new FakeSocket();
    const otherUser = new FakeSocket();
    attach(hub, 1, first, 101);
    attach(hub, 1, second, 102);
    attach(hub, 2, otherUser, 201);

    expect(hub.disconnectUser(1)).toBe(2);

    expect(first.close).toHaveBeenCalledWith(1008, "User credentials revoked");
    expect(second.close).toHaveBeenCalledWith(1008, "User credentials revoked");
    expect(otherUser.close).not.toHaveBeenCalled();
    expect(hub.connectionCount(1)).toBe(0);
    expect(hub.connectionCount(2)).toBe(1);
  });

  it("disconnects all current clients without shutting down the hub", () => {
    const hub = createHub();
    const first = new FakeSocket();
    const second = new FakeSocket();
    attach(hub, 1, first, 101);
    attach(hub, 2, second, 201);

    expect(hub.disconnectAll()).toBe(2);
    expect(hub.connectionCount()).toBe(0);
    expect(first.close).toHaveBeenCalledWith(1008, "Authentication state replaced");
    expect(second.close).toHaveBeenCalledWith(1008, "Authentication state replaced");

    const replacement = new FakeSocket();
    expect(attach(hub, 1, replacement, 103)).toBe(true);
    replacement.send.mockClear();
    replacement.ping.mockClear();
    expect(() => (hub as unknown as { pingClients(): void }).pingClients()).not.toThrow();
    expect(replacement.send).toHaveBeenCalledOnce();
    expect(replacement.ping).toHaveBeenCalledOnce();
  });

  it("limits connections per API token without blocking another device", () => {
    const hub = createHub();
    expect(attach(hub, 1, new FakeSocket(), 101)).toBe(true);
    expect(attach(hub, 1, new FakeSocket(), 101)).toBe(true);
    expect(attach(hub, 1, new FakeSocket(), 101)).toBe(true);

    const excessive = new FakeSocket();
    expect(attach(hub, 1, excessive, 101)).toBe(false);
    expect(excessive.close).toHaveBeenCalledWith(1013, "Too many realtime connections for this API token");

    expect(attach(hub, 1, new FakeSocket(), 102)).toBe(true);
    expect(hub.connectionCount(1)).toBe(4);
  });

  it("disconnects a naturally expired API token during heartbeat without a REST request", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T10:00:00.000Z"));
    const hub = createHub();
    const socket = new FakeSocket();
    const expiresAt = new Date(Date.now() + 1000);
    expect(hub.attach(1, 101, socket as never, expiresAt)).toBe(true);

    vi.setSystemTime(expiresAt);
    expect(() => (hub as unknown as { pingClients(): void }).pingClients()).not.toThrow();
    expect(socket.close).toHaveBeenCalledWith(1008, "API token expired");
    expect(hub.connectionCount(1)).toBe(0);
  });
});
