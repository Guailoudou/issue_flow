import { PrismaClient } from "@prisma/client";
import { ensureBootstrapData } from "../src/bootstrap";

const prisma = new PrismaClient();
await ensureBootstrapData(prisma);
await prisma.$disconnect();
