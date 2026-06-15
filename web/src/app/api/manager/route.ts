import { NextResponse } from 'next/server';
import { listManagersForOwner } from '@hunchbook/shared';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner');
  if (!owner?.startsWith('0x')) {
    return NextResponse.json({ error: 'owner query param required' }, { status: 400 });
  }
  try {
    const managers = await listManagersForOwner(owner);
    return NextResponse.json({ managerId: managers[0]?.manager_id ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
