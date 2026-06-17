import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/server/profiles-db';
import {
  profileReadMessage,
  timestampFresh,
  verifyOwnership,
} from '@/lib/server/profile-auth';

export const dynamic = 'force-dynamic';

/** Owner's full profile (email included) — requires a fresh signed read message. */
export async function POST(req: Request) {
  const { address, timestamp, signature } = (await req.json()) as {
    address?: string;
    timestamp?: number;
    signature?: string;
  };
  if (!address?.startsWith('0x') || !timestamp || !signature) {
    return NextResponse.json({ error: 'address, timestamp, signature required' }, { status: 400 });
  }
  if (!timestampFresh(timestamp)) {
    return NextResponse.json({ error: 'Signature expired.' }, { status: 401 });
  }
  const ok = await verifyOwnership(profileReadMessage(timestamp), signature, address);
  if (!ok) {
    return NextResponse.json({ error: 'Signature verification failed.' }, { status: 401 });
  }
  const row = await getProfile(address);
  return NextResponse.json(
    row
      ? {
          address: row.address,
          username: row.username,
          email: row.email,
          bio: row.bio,
          views: row.views,
          createdAt: row.created_at,
        }
      : {},
  );
}
