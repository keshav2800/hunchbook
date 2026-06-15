import { NextResponse } from 'next/server';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { DUSDC_COIN_TYPE, SUI_FULLNODE_URL } from '@hunchbook/shared';

export const dynamic = 'force-dynamic';

const DROP_RAW = 10_000_000n; // 10 dUSDC (6 decimals)
const served = new Set<string>(); // naive per-process rate limit

export async function POST(req: Request) {
  const { address } = (await req.json()) as { address: string };
  if (!address?.startsWith('0x')) {
    return NextResponse.json({ error: 'address required' }, { status: 400 });
  }
  if (served.has(address)) {
    return NextResponse.json({ error: 'Faucet already used for this address' }, { status: 429 });
  }
  const pk = process.env.TREASURY_SUI_PRIVATE_KEY;
  if (!pk) {
    return NextResponse.json({ error: 'Faucet not configured' }, { status: 503 });
  }
  try {
    const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(pk).secretKey);
    const client = new SuiClient({ url: SUI_FULLNODE_URL });
    const treasury = keypair.toSuiAddress();

    const coins = await client.getCoins({ owner: treasury, coinType: DUSDC_COIN_TYPE });
    if (coins.data.length === 0) {
      return NextResponse.json({ error: 'Treasury has no dUSDC' }, { status: 503 });
    }
    const tx = new Transaction();
    const primary = coins.data[0]!;
    if (coins.data.length > 1) {
      tx.mergeCoins(
        tx.object(primary.coinObjectId),
        coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
      );
    }
    const [drop] = tx.splitCoins(tx.object(primary.coinObjectId), [tx.pure.u64(DROP_RAW)]);
    tx.transferObjects([drop!], address);

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });
    served.add(address);
    return NextResponse.json({ digest: result.digest, amount: 10 });
  } catch (err) {
    return NextResponse.json(
      { error: `Faucet failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
