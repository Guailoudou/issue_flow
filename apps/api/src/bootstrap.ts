import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export async function ensureBootstrapData(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await prisma.platformSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await prisma.ossSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await Promise.all([
    prisma.commitAction.upsert({ where: { id: 1 }, update: { isSystem: true }, create: { id: 1, name: "开启 Issue", keyword: "o", state: "OPEN", isSystem: true } }),
    prisma.commitAction.upsert({ where: { id: 2 }, update: { isSystem: true }, create: { id: 2, name: "关闭 Issue", keyword: "c", state: "CLOSED", isSystem: true } }),
  ]);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (admin) return admin;
  const username = process.env.ADMIN_USERNAME?.trim() || "admin";
  const password = process.env.ADMIN_PASSWORD || "change-me-now";
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    return await prisma.user.create({ data: { username, passwordHash, displayName: process.env.ADMIN_DISPLAY_NAME?.trim() || "Platform Admin", role: "ADMIN", businessRoles: { create: { role: "DEVELOPMENT" } } } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const concurrentlyCreated = await prisma.user.findFirst({ where: { role: "ADMIN" } });
      if (concurrentlyCreated) return concurrentlyCreated;
    }
    throw error;
  }
}
