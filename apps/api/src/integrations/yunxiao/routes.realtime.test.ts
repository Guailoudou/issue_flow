import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { publishYunxiaoRealtime } from "./routes";

const issue = { id: 41, updatedAt: new Date("2026-08-31T08:00:00.000Z") };
const notification = (id: number, userId: number) => ({
  id,
  userId,
  issueId: issue.id,
  type: "YUNXIAO_COMMIT_CLOSED",
  message: `Notification ${id}`,
  readAt: null,
  createdAt: new Date(`2026-08-31T08:00:0${id % 10}.000Z`),
});

function harness(options: { publish?: ReturnType<typeof vi.fn> } = {}) {
  const publish = options.publish ?? vi.fn();
  const warn = vi.fn();
  const notifications = [notification(101, 21), notification(102, 22)];
  const prisma = {
    issue: { findUnique: vi.fn().mockResolvedValue(issue) },
    subscription: { findMany: vi.fn().mockResolvedValue([{ userId: 21 }, { userId: 22 }]) },
    issueAssignee: { findMany: vi.fn().mockResolvedValue([{ userId: 22 }, { userId: 23 }]) },
    notification: { findMany: vi.fn().mockResolvedValue(notifications) },
  } as unknown as PrismaClient;
  const app = { realtime: { publish }, log: { warn } } as unknown as FastifyInstance;
  return { app, prisma, publish, warn, notifications };
}

describe("Yunxiao realtime publishing", () => {
  it("publishes only the committed issue and notification IDs to their exact users", async () => {
    const { app, prisma, publish } = harness();

    await publishYunxiaoRealtime(app, prisma, {
      changedIssues: [{ issueId: issue.id, actorId: 1 }],
      notificationIds: [102, 101],
    });

    expect(publish).toHaveBeenNthCalledWith(1, [21, 22, 23], {
      type: "issue.changed",
      issueId: issue.id,
      updatedAt: issue.updatedAt.toISOString(),
      actorId: 1,
    });
    expect(publish).toHaveBeenNthCalledWith(2, [22], expect.objectContaining({
      type: "notification.created",
      notification: expect.objectContaining({ id: 102, issueId: issue.id }),
    }));
    expect(publish).toHaveBeenNthCalledWith(3, [21], expect.objectContaining({
      type: "notification.created",
      notification: expect.objectContaining({ id: 101, issueId: issue.id }),
    }));
    const notificationEvent = publish.mock.calls[1]?.[1] as { notification: Record<string, unknown> };
    expect(notificationEvent.notification).toEqual({
      id: 102,
      issueId: issue.id,
      type: "YUNXIAO_COMMIT_CLOSED",
      message: "Notification 102",
      readAt: null,
      createdAt: "2026-08-31T08:00:02.000Z",
    });
  });

  it("warns and continues when one realtime delivery throws", async () => {
    const publish = vi.fn()
      .mockImplementationOnce(() => { throw new Error("broken socket"); })
      .mockImplementation(() => undefined);
    const { app, prisma, warn } = harness({ publish });

    await expect(publishYunxiaoRealtime(app, prisma, {
      changedIssues: [{ issueId: issue.id, actorId: 1 }],
      notificationIds: [101],
    })).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: issue.id, err: expect.any(Error) }),
      "Yunxiao realtime issue event publish failed",
    );
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith([21], expect.objectContaining({ type: "notification.created" }));
  });
});
