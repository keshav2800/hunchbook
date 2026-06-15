import { NextResponse } from 'next/server';
import { EnokiClient } from '@mysten/enoki';
import {
  MARKET_KEY_MODULE,
  PREDICT_MANAGER_MODULE,
  PREDICT_MODULE,
  PREDICT_PACKAGE_ID,
  RANGE_KEY_MODULE,
  ROUTER_MODULE,
  ROUTER_PACKAGE_ID,
  VAULT_MODULE,
  VAULT_PACKAGE_ID,
} from '@hunchbook/shared';

export const dynamic = 'force-dynamic';

const ALLOWED_TARGETS = [
  `${ROUTER_PACKAGE_ID}::${ROUTER_MODULE}::place_bet`,
  `${ROUTER_PACKAGE_ID}::${ROUTER_MODULE}::cashout`,
  `${PREDICT_PACKAGE_ID}::${PREDICT_MODULE}::create_manager`,
  `${PREDICT_PACKAGE_ID}::${MARKET_KEY_MODULE}::up`,
  `${PREDICT_PACKAGE_ID}::${MARKET_KEY_MODULE}::down`,
  `${PREDICT_PACKAGE_ID}::${PREDICT_MANAGER_MODULE}::withdraw`,
  // Range bets skip the router (router::place_bet is MarketKey-typed), so the
  // PTB hits predict directly: deposit stake → build key → mint. redeem_range
  // is the matching user-facing exit for when range cashout is wired up.
  `${PREDICT_PACKAGE_ID}::${PREDICT_MANAGER_MODULE}::deposit`,
  `${PREDICT_PACKAGE_ID}::${RANGE_KEY_MODULE}::new`,
  `${PREDICT_PACKAGE_ID}::${PREDICT_MODULE}::mint_range`,
  `${PREDICT_PACKAGE_ID}::${PREDICT_MODULE}::redeem_range`,
  // LP-facing vault entry points only — operator functions are never sponsored.
  `${VAULT_PACKAGE_ID}::${VAULT_MODULE}::deposit`,
  `${VAULT_PACKAGE_ID}::${VAULT_MODULE}::withdraw`,
];

export async function POST(req: Request) {
  const { transactionKindBytes, sender } = (await req.json()) as {
    transactionKindBytes: string; // base64
    sender: string;
  };
  if (!transactionKindBytes || !sender) {
    return NextResponse.json(
      { error: 'transactionKindBytes and sender required' },
      { status: 400 },
    );
  }
  try {
    const enoki = new EnokiClient({ apiKey: process.env.ENOKI_SECRET_KEY! });
    const sponsored = await enoki.createSponsoredTransaction({
      network: 'testnet',
      transactionKindBytes,
      sender,
      allowedMoveCallTargets: ALLOWED_TARGETS,
      allowedAddresses: [sender],
    });
    return NextResponse.json(sponsored); // { bytes, digest }
  } catch (err) {
    return NextResponse.json({ error: `Sponsorship failed: ${describeEnokiError(err)}` }, { status: 502 });
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
