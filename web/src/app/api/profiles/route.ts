import { NextResponse } from 'next/server';
import { getUsernames } from '@/lib/server/profiles-db';

export const dynamic = 'force-dynamic';

const MAX_BATCH = 50;

/** Public username lookup for a batch of addresses (leaderboard etc.). */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('addresses') ?? '';
  const addresses = raw
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.startsWith('0x'))
    .slice(0, MAX_BATCH);
  return NextResponse.json({ usernames: await getUsernames(addresses) });
}
