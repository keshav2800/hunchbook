import { prisma } from '@/lib/server/prisma';

export interface ProfileRow {
  address: string;
  username: string;
  email: string;
  bio: string;
  views: number;
  created_at: number; // unix ms
  updated_at: number; // unix ms
}

function toRow(p: {
  address: string;
  username: string;
  email: string;
  bio: string;
  views: number;
  createdAt: Date;
  updatedAt: Date;
}): ProfileRow {
  return {
    address: p.address,
    username: p.username,
    email: p.email,
    bio: p.bio,
    views: p.views,
    created_at: p.createdAt.getTime(),
    updated_at: p.updatedAt.getTime(),
  };
}

export async function getProfile(address: string): Promise<ProfileRow | null> {
  const p = await prisma.profile.findUnique({ where: { address } });
  return p ? toRow(p) : null;
}

/**
 * Public profile read that counts as a view: atomically bumps the counter and
 * returns the fresh row. Returns null when the address has no profile yet.
 */
export async function recordProfileView(address: string): Promise<ProfileRow | null> {
  try {
    const p = await prisma.profile.update({
      where: { address },
      data: { views: { increment: 1 } },
    });
    return toRow(p);
  } catch {
    return null; // P2025: no such profile — nothing to view
  }
}

/** Public usernames for a batch of addresses (missing entries omitted). */
export async function getUsernames(addresses: string[]): Promise<Record<string, string>> {
  if (addresses.length === 0) return {};
  const rows = await prisma.profile.findMany({
    where: { address: { in: addresses } },
    select: { address: true, username: true },
  });
  return Object.fromEntries(rows.map((r) => [r.address, r.username]));
}

export async function upsertProfile(p: {
  address: string;
  username: string;
  email: string;
  bio: string;
}): Promise<'ok' | 'username_taken'> {
  // Case-insensitive username uniqueness, excluding the caller's own row.
  const clash = await prisma.profile.findFirst({
    where: { username: { equals: p.username, mode: 'insensitive' }, address: { not: p.address } },
    select: { address: true },
  });
  if (clash) return 'username_taken';

  // Email is write-once: set from Google sign-in, then immutable.
  const existing = await prisma.profile.findUnique({
    where: { address: p.address },
    select: { email: true },
  });
  const email = existing && existing.email !== '' ? existing.email : p.email;

  await prisma.profile.upsert({
    where: { address: p.address },
    create: { address: p.address, username: p.username, email, bio: p.bio },
    update: { username: p.username, email, bio: p.bio },
  });
  return 'ok';
}
