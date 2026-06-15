import { NextResponse } from 'next/server';
import { EnokiClient } from '@mysten/enoki';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { digest, signature } = (await req.json()) as { digest: string; signature: string };
  if (!digest || !signature) {
    return NextResponse.json({ error: 'digest and signature required' }, { status: 400 });
  }
  try {
    const enoki = new EnokiClient({ apiKey: process.env.ENOKI_SECRET_KEY! });
    await enoki.executeSponsoredTransaction({ digest, signature });
    return NextResponse.json({ digest });
  } catch (err) {
    return NextResponse.json({ error: `Execution failed: ${describeEnokiError(err)}` }, { status: 502 });
  }
}

/** EnokiClientError hides the real reason in .errors/.code — surface it. */
function describeEnokiError(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & { code?: string; errors?: { message?: string; code?: string }[] };
    const details = e.errors?.map((x) => x.message ?? x.code).filter(Boolean).join('; ');
    return details ? `${e.message} — ${details}` : `${e.message}${e.code ? ` (${e.code})` : ''}`;
  }
  return String(err);
}
