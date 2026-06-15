import { PrismaClient } from '@prisma/client';

// One client reused across hot-reloads (dev) and serverless invocations (Vercel)
// so we don't exhaust Neon connections. Pair with Neon's POOLED connection
// string in DATABASE_URL (host contains `-pooler`).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
