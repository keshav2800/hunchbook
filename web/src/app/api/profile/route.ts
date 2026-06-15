import { NextResponse } from 'next/server';
import { getProfile, upsertProfile } from '@/lib/server/profiles-db';

import {
  profileWriteMessage,
  timestampFresh,
  verifyOwnership,
} from '@/lib/server/profile-auth';
import { validateProfile } from '@/lib/profile-validation';

export const dynamic = 'force-dynamic';

/** Public profile — never includes email. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address');
  if (!address?.startsWith('0x')) {
    return NextResponse.json({ error: 'address query param required' }, { status: 400 });
  }
  const row = getProfile(address);
  return NextResponse.json(
    row ? { address: row.address, username: row.username, bio: row.bio } : {},
  );
}

export async function PUT(req: Request) {
  const body = (await req.json()) as {
    address?: string;
    username?: string;
    email?: string;
    bio?: string;
    timestamp?: number;
    signature?: string;
  };
  const { address, timestamp, signature } = body;
  const username = (body.username ?? '').trim();
  const email = (body.email ?? '').trim();
  const bio = (body.bio ?? '').trim();

  if (!address?.startsWith('0x') || !timestamp || !signature) {
    return NextResponse.json({ error: 'address, timestamp, signature required' }, { status: 400 });
  }
  const invalid = validateProfile({ username, email, bio });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  if (!timestampFresh(timestamp)) {
    return NextResponse.json({ error: 'Signature expired — try saving again.' }, { status: 401 });
  }
  const ok = await verifyOwnership(
    profileWriteMessage(timestamp, username, email, bio),
    signature,
    address,
  );
  if (!ok) {
    return NextResponse.json({ error: 'Signature verification failed.' }, { status: 401 });
  }

  if (upsertProfile({ address, username, email, bio }) === 'username_taken') {
    return NextResponse.json({ error: 'That username is taken.' }, { status: 409 });
  }
  // Return what was actually stored — the email column is first-write-wins,
  // so an attempted change comes back as the original value.
  const row = getProfile(address);
  return NextResponse.json({
    address,
    username: row?.username ?? username,
    email: row?.email ?? email,
    bio: row?.bio ?? bio,
  });
}
