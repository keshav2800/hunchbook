# zkLogin + Real Bet Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google sign-in via Enoki zkLogin, sponsored gas, a demo dUSDC faucet, and real `router::place_bet` transactions from Quick Bet and Strike Studio on Sui testnet.

**Architecture:** dapp-kit `WalletProvider` + `registerEnokiWallets` for auth; client builds the bet PTB (mirroring the proven `scripts/src/phase1-router-roundtrip.ts` flow) as transaction-kind bytes; `/api/sponsor` (Enoki private key) sponsors and `/api/sponsor/execute` submits; `/api/manager` resolves PredictManager ownership; `/api/faucet` sends 10 dUSDC from the treasury wallet.

**Tech Stack:** `@mysten/dapp-kit`, `@mysten/enoki`, `@mysten/sui`, `@hunchbook/shared` builders, shadcn `dropdown-menu` + `sonner` toasts.

**Spec:** `docs/superpowers/specs/2026-06-10-zklogin-bet-placement-design.md`

**Plan-level notes:**
- **No commits** (not a git repo), **no build/typecheck/lint runs** (user preference — user verifies via `pnpm web:dev`).
- **dUSDC has 6 decimals** (`PHASE0_DEFAULT_QUANTITY = 1_000_000n` = 1 unit paying $1). Strikes/prices on-chain are u64 scaled 1e9.
- Quantity semantics (from phase1 + `router.move`): `place_bet` deposits `payment` net of 1% fee into the manager, then `predict::mint` pulls `probability × quantity` from manager balance. We size `quantity = net_stake / p_win × 0.98` (2% buffer for price drift; dust stays reclaimable in the manager).

---

### Task 0: Manual setup (USER does this — Claude writes `.env.local.example` only)

- [ ] **Step 1 (user): Google OAuth client.** Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID → type "Web application" → Authorized JavaScript origins: `http://localhost:3000` → copy the **Client ID**.
- [ ] **Step 2 (user): Enoki Portal** (https://portal.enoki.mystenlabs.com): create project → Auth providers → add Google with the Client ID from step 1 → API Keys → create **Public** key (features: zkLogin; network: testnet) and **Private** key (features: Sponsored transactions; network: testnet).
- [ ] **Step 3 (user): Treasury key.** Export the funded wallet's private key: `sui keytool export --key-identity <address>` → copy the `suiprivkey...` string. (Never paste it into chat — only into `.env.local`.)
- [ ] **Step 4: Create `web/.env.local.example`** (Claude) — user copies to `web/.env.local` and fills in:

```bash
# Enoki public key (zkLogin, testnet) — safe to expose to the browser
NEXT_PUBLIC_ENOKI_API_KEY=
# Google OAuth web client ID
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
# Enoki PRIVATE key (sponsored transactions, testnet) — server only
ENOKI_SECRET_KEY=
# Treasury wallet private key (suiprivkey...) holding testnet dUSDC + SUI — server only
TREASURY_SUI_PRIVATE_KEY=
```

---

### Task 1: Dependencies + providers

**Files:**
- Modify: `web/package.json` (via pnpm)
- Modify: `web/src/app/providers.tsx`
- Modify: `web/src/app/layout.tsx` (add `<Toaster />`)

- [ ] **Step 1: Install deps**

```bash
pnpm --filter @hunchbook/web add @mysten/dapp-kit @mysten/enoki @mysten/sui
cd web && pnpm dlx shadcn@latest add dropdown-menu sonner && cd ..
```

- [ ] **Step 2: Replace `web/src/app/providers.tsx`**

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createNetworkConfig, SuiClientProvider, useSuiClientContext, WalletProvider } from '@mysten/dapp-kit';
import { isEnokiNetwork, registerEnokiWallets } from '@mysten/enoki';
import { getFullnodeUrl } from '@mysten/sui/client';
import { useEffect, useState } from 'react';

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl('testnet') },
});

function RegisterEnokiWallets() {
  const { client, network } = useSuiClientContext();
  useEffect(() => {
    if (!isEnokiNetwork(network)) return;
    const { unregister } = registerEnokiWallets({
      apiKey: process.env.NEXT_PUBLIC_ENOKI_API_KEY!,
      providers: {
        google: { clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID! },
      },
      client,
      network,
    });
    return unregister;
  }, [client, network]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <RegisterEnokiWallets />
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3:** In `web/src/app/layout.tsx`, add to imports `import { Toaster } from '@/components/ui/sonner';` and render `<Toaster position="bottom-right" />` as the last child inside `<Providers>` (after `</SidebarProvider>`).

---

### Task 2: Sign-in button (top bar)

**Files:**
- Create: `web/src/components/auth/connect-button.tsx`
- Modify: `web/src/components/app-shell/top-bar.tsx`

- [ ] **Step 1: Create `web/src/components/auth/connect-button.tsx`**

```tsx
'use client';

import { useConnectWallet, useCurrentAccount, useDisconnectWallet, useWallets } from '@mysten/dapp-kit';
import { getWalletMetadata, isEnokiWallet } from '@mysten/enoki';
import { ChevronDown, LogOut, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectButton() {
  const account = useCurrentAccount();
  const wallets = useWallets().filter(isEnokiWallet);
  const { mutate: connect, isPending } = useConnectWallet();
  const { mutate: disconnect } = useDisconnectWallet();

  if (account) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Wallet className="size-4" />
            {shortAddress(account.address)}
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="font-mono text-xs">{shortAddress(account.address)}</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => navigator.clipboard.writeText(account.address)}
          >
            Copy address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => disconnect()}>
            <LogOut className="size-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const google = wallets.find((w) => getWalletMetadata(w)?.provider === 'google');

  return (
    <Button
      size="sm"
      disabled={!google || isPending}
      onClick={() =>
        google &&
        connect(
          { wallet: google },
          { onError: (e) => toast.error(`Sign-in failed: ${e.message}`) },
        )
      }
    >
      <Wallet className="size-4" />
      {isPending ? 'Signing in…' : 'Sign in with Google'}
    </Button>
  );
}
```

- [ ] **Step 2:** In `web/src/components/app-shell/top-bar.tsx`: replace the stub `<Button size="sm">…Connect Wallet</Button>` (and its comment and the now-unused `Wallet`/`Button` imports) with `<ConnectButton />`, importing it from `@/components/auth/connect-button`.

---

### Task 3: Chain helpers — balance, manager, bet PTB

**Files:**
- Create: `web/src/lib/chain.ts`

- [ ] **Step 1: Create `web/src/lib/chain.ts`**

```ts
import { Transaction } from '@mysten/sui/transactions';
import type { SuiClient } from '@mysten/sui/client';
import {
  DUSDC_COIN_TYPE,
  addMarketKeyDown,
  addMarketKeyUp,
  addPlaceBetCall,
  buildCreateManagerTx,
} from '@hunchbook/shared';
import type { Direction, LiveMarket } from '@/lib/types';

export const DUSDC_SCALE = 1e6; // dUSDC has 6 decimals
export const STRIKE_SCALE = 1e9; // on-chain prices/strikes are u64 × 1e9

export { buildCreateManagerTx, DUSDC_COIN_TYPE };

export async function getDusdcBalance(client: SuiClient, owner: string): Promise<number> {
  const bal = await client.getBalance({ owner, coinType: DUSDC_COIN_TYPE });
  return Number(bal.totalBalance) / DUSDC_SCALE;
}

/** quantity (raw) = net stake / p_win, with a 2% buffer for price drift. */
export function computeQuantityRaw(stakeUsd: number, pWin: number): bigint {
  const netRaw = stakeUsd * DUSDC_SCALE * 0.99; // router skims 1%
  return BigInt(Math.floor((netRaw * 0.98) / Math.max(pWin, 0.01)));
}

/** Snap a USD strike to the oracle tick grid, in raw 1e9 units. */
export function strikeToRaw(strikeUsd: number, tickSizeUsd: number): bigint {
  const tickRaw = BigInt(Math.round(tickSizeUsd * STRIKE_SCALE));
  const raw = BigInt(Math.round(strikeUsd * STRIKE_SCALE));
  return (raw / tickRaw) * tickRaw;
}

/**
 * Build the bet PTB, mirroring scripts/src/phase1-router-roundtrip.ts:
 * merge dUSDC coins → split payment → market key → router::place_bet.
 */
export async function buildPlaceBetTx(args: {
  client: SuiClient;
  sender: string;
  managerId: string;
  market: LiveMarket;
  direction: Direction;
  strikeUsd: number;
  stakeUsd: number;
  pWin: number;
}): Promise<Transaction> {
  const { client, sender, managerId, market, direction, strikeUsd, stakeUsd, pWin } = args;
  const tx = new Transaction();
  tx.setSender(sender);

  const coins = await client.getCoins({ owner: sender, coinType: DUSDC_COIN_TYPE });
  if (coins.data.length === 0) throw new Error('No dUSDC in wallet — use the faucet first.');
  const primary = coins.data[0]!;
  if (coins.data.length > 1) {
    tx.mergeCoins(
      tx.object(primary.coinObjectId),
      coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }

  const stakeRaw = BigInt(Math.round(stakeUsd * DUSDC_SCALE));
  const total = coins.data.reduce((acc, c) => acc + BigInt(c.balance), 0n);
  if (total < stakeRaw) {
    throw new Error(`Insufficient dUSDC: have ${Number(total) / DUSDC_SCALE}, need ${stakeUsd}.`);
  }
  const [payment] = tx.splitCoins(tx.object(primary.coinObjectId), [tx.pure.u64(stakeRaw)]);

  const keyArgs = {
    oracleId: market.oracleId,
    expiry: BigInt(market.expiry),
    strike: strikeToRaw(strikeUsd, market.tickSize),
  };
  const keyArg = direction === 'UP' ? addMarketKeyUp(tx, keyArgs) : addMarketKeyDown(tx, keyArgs);

  addPlaceBetCall(tx, {
    managerId,
    oracleId: market.oracleId,
    keyArg,
    quantity: computeQuantityRaw(stakeUsd, pWin),
    paymentCoin: payment!,
  });

  return tx;
}
```

---

### Task 4: Server routes — manager lookup, sponsor, execute, faucet

**Files:**
- Create: `web/src/app/api/manager/route.ts`
- Create: `web/src/app/api/sponsor/route.ts`
- Create: `web/src/app/api/sponsor/execute/route.ts`
- Create: `web/src/app/api/faucet/route.ts`

- [ ] **Step 1: Create `web/src/app/api/manager/route.ts`**

```ts
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
```

- [ ] **Step 2: Create `web/src/app/api/sponsor/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { EnokiClient } from '@mysten/enoki';
import {
  MARKET_KEY_MODULE,
  PREDICT_MODULE,
  PREDICT_PACKAGE_ID,
  ROUTER_MODULE,
  ROUTER_PACKAGE_ID,
} from '@hunchbook/shared';

export const dynamic = 'force-dynamic';

const ALLOWED_TARGETS = [
  `${ROUTER_PACKAGE_ID}::${ROUTER_MODULE}::place_bet`,
  `${PREDICT_PACKAGE_ID}::${PREDICT_MODULE}::create_manager`,
  `${PREDICT_PACKAGE_ID}::${MARKET_KEY_MODULE}::up`,
  `${PREDICT_PACKAGE_ID}::${MARKET_KEY_MODULE}::down`,
];

export async function POST(req: Request) {
  const { transactionKindBytes, sender } = (await req.json()) as {
    transactionKindBytes: string; // base64
    sender: string;
  };
  if (!transactionKindBytes || !sender) {
    return NextResponse.json({ error: 'transactionKindBytes and sender required' }, { status: 400 });
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
    return NextResponse.json(
      { error: `Sponsorship failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 3: Create `web/src/app/api/sponsor/execute/route.ts`**

```ts
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
    return NextResponse.json(
      { error: `Execution failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 4: Create `web/src/app/api/faucet/route.ts`**

```ts
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
```

---

### Task 5: The place-bet hook (orchestration)

**Files:**
- Create: `web/src/lib/use-place-bet.ts`

- [ ] **Step 1: Create `web/src/lib/use-place-bet.ts`**

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentAccount, useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { toBase64 } from '@mysten/sui/utils';
import { toast } from 'sonner';
import { buildCreateManagerTx, buildPlaceBetTx, getDusdcBalance } from '@/lib/chain';
import type { Direction, LiveMarket } from '@/lib/types';

const EXPLORER = 'https://suiscan.xyz/testnet/tx';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${url} → ${res.status}`);
  return json;
}

async function getManagerId(owner: string): Promise<string | null> {
  const res = await fetch(`/api/manager?owner=${owner}`);
  const json = (await res.json()) as { managerId: string | null; error?: string };
  if (!res.ok) throw new Error(json.error ?? 'manager lookup failed');
  return json.managerId;
}

export function useDusdcBalance() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  return useQuery({
    queryKey: ['dusdc-balance', account?.address],
    queryFn: () => getDusdcBalance(client, account!.address),
    enabled: !!account,
    refetchInterval: 10_000,
  });
}

export function useFaucet() {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<{ digest: string }>('/api/faucet', { address: account!.address }),
    onSuccess: ({ digest }) => {
      toast.success('10 test dUSDC sent', {
        action: { label: 'Explorer', onClick: () => window.open(`${EXPLORER}/${digest}`) },
      });
      queryClient.invalidateQueries({ queryKey: ['dusdc-balance'] });
    },
    onError: (e) => toast.error(e.message),
  });
}

/** Sponsor → sign → execute one transaction built as kind-bytes. */
function useSponsoredExecutor() {
  const client = useSuiClient();
  const { mutateAsync: signTransaction } = useSignTransaction();

  return async (txKindBase64: string, sender: string): Promise<string> => {
    const sponsored = await postJson<{ bytes: string; digest: string }>('/api/sponsor', {
      transactionKindBytes: txKindBase64,
      sender,
    });
    const { signature } = await signTransaction({ transaction: sponsored.bytes });
    await postJson('/api/sponsor/execute', { digest: sponsored.digest, signature });
    await client.waitForTransaction({ digest: sponsored.digest });
    return sponsored.digest;
  };
}

export function usePlaceBet() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const execute = useSponsoredExecutor();

  return useMutation({
    mutationFn: async (args: {
      market: LiveMarket;
      direction: Direction;
      strikeUsd: number;
      stakeUsd: number;
      pWin: number;
    }) => {
      if (!account) throw new Error('Sign in first.');
      const sender = account.address;

      // 1. Ensure PredictManager exists (sponsored create on first bet)
      let managerId = await getManagerId(sender);
      if (!managerId) {
        toast.info('Setting up your account…');
        const createTx = buildCreateManagerTx();
        createTx.setSender(sender);
        const kind = await createTx.build({ client, onlyTransactionKind: true });
        await execute(toBase64(kind), sender);
        // poll the indexer for the new manager (it indexes by checkpoint)
        for (let i = 0; i < 15 && !managerId; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          managerId = await getManagerId(sender);
        }
        if (!managerId) throw new Error('Account setup not indexed yet — try again in a moment.');
      }

      // 2. Build + sponsor + sign + execute the bet
      const tx = await buildPlaceBetTx({ ...args, client, sender, managerId });
      const kind = await tx.build({ client, onlyTransactionKind: true });
      return execute(toBase64(kind), sender);
    },
    onSuccess: (digest, { direction, stakeUsd, market }) => {
      toast.success(`Bet placed: ${stakeUsd} dUSDC ${direction} on ${market.pair}`, {
        action: { label: 'Explorer', onClick: () => window.open(`${EXPLORER}/${digest}`) },
      });
      queryClient.invalidateQueries({ queryKey: ['dusdc-balance'] });
    },
    onError: (e) => toast.error(e.message),
  });
}
```

---

### Task 6: Wire the UI — Quick Bet, Strike Studio, faucet button

**Files:**
- Modify: `web/src/components/trade/quick-bet-panel.tsx`
- Modify: `web/src/app/strike/page.tsx`
- Create: `web/src/components/auth/faucet-button.tsx`

- [ ] **Step 1: Create `web/src/components/auth/faucet-button.tsx`**

```tsx
'use client';

import { useCurrentAccount } from '@mysten/dapp-kit';
import { Droplets } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDusdcBalance, useFaucet } from '@/lib/use-place-bet';

/** Shows "Get test dUSDC" when the signed-in user's balance is zero. */
export function FaucetButton() {
  const account = useCurrentAccount();
  const balance = useDusdcBalance();
  const faucet = useFaucet();

  if (!account || balance.data === undefined || balance.data > 0) return null;

  return (
    <Button variant="outline" size="sm" disabled={faucet.isPending} onClick={() => faucet.mutate()}>
      <Droplets className="size-4" />
      {faucet.isPending ? 'Sending…' : 'Get test dUSDC'}
    </Button>
  );
}
```

- [ ] **Step 2: Quick Bet panel.** In `web/src/components/trade/quick-bet-panel.tsx`:

Add imports:

```tsx
import { useCurrentAccount } from '@mysten/dapp-kit';
import { usePlaceBet, useDusdcBalance } from '@/lib/use-place-bet';
import { FaucetButton } from '@/components/auth/faucet-button';
```

Inside the component (after the existing state), add:

```tsx
const account = useCurrentAccount();
const placeBet = usePlaceBet();
const balance = useDusdcBalance();
```

Replace the static `<Button className="w-full" size="lg">Place Bet</Button>` with:

```tsx
<div className="space-y-2">
  <Button
    className="w-full"
    size="lg"
    disabled={!account || placeBet.isPending || stakeNum <= 0}
    onClick={() => {
      const strikeUsd = Math.round(market.spot / market.tickSize) * market.tickSize;
      placeBet.mutate({ market, direction, strikeUsd, stakeUsd: stakeNum, pWin });
    }}
  >
    {placeBet.isPending ? 'Placing bet…' : account ? 'Place Bet' : 'Sign in to bet'}
  </Button>
  <div className="flex items-center justify-between">
    <FaucetButton />
    {account && balance.data !== undefined ? (
      <span className="ml-auto text-xs text-muted-foreground">
        Balance: {balance.data.toFixed(2)} dUSDC
      </span>
    ) : null}
  </div>
</div>
```

- [ ] **Step 3: Strike Studio.** In `web/src/app/strike/page.tsx`:

Add imports:

```tsx
import { useCurrentAccount } from '@mysten/dapp-kit';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { usePlaceBet } from '@/lib/use-place-bet';
import { FaucetButton } from '@/components/auth/faucet-button';
import type { Direction } from '@/lib/types';
```

Add state + hooks next to the existing ones:

```tsx
const [direction, setDirection] = useState<Direction>('UP');
const account = useCurrentAccount();
const placeBet = usePlaceBet();
```

In the Wager card, above the wager input, add a direction toggle (custom-strike UP/DOWN — range stays quote-only since the router has no range entrypoint):

```tsx
<ToggleGroup
  type="single"
  variant="outline"
  className="w-full"
  value={direction}
  onValueChange={(v) => v && setDirection(v as Direction)}
>
  <ToggleGroupItem value="UP" className="flex-1 data-[state=on]:bg-positive/15 data-[state=on]:text-positive">
    <ArrowUp className="size-4" /> Above strike
  </ToggleGroupItem>
  <ToggleGroupItem value="DOWN" className="flex-1 data-[state=on]:bg-negative/15 data-[state=on]:text-negative">
    <ArrowDown className="size-4" /> Below strike
  </ToggleGroupItem>
</ToggleGroup>
```

Compute the win probability for the chosen direction (next to `strikeMult`):

```tsx
const pUpAtStrike = svi ? binaryUpProbability(market.forward, strike, svi) : 0.5;
const pWin = direction === 'UP' ? pUpAtStrike : 1 - pUpAtStrike;
const dirMult = svi ? probabilityToOdds(pWin) : 0;
```

Change the "Custom Strike" badge to use `dirMult` (`{direction} pays {dirMult.toFixed(2)}x`), the potential payout line to `{formatNumber(wagerNum * dirMult)} dUSDC`, and replace the static Place Bet button with:

```tsx
<Button
  className="w-full"
  size="lg"
  disabled={!account || placeBet.isPending || wagerNum <= 0}
  onClick={() =>
    placeBet.mutate({ market, direction, strikeUsd: strike, stakeUsd: wagerNum, pWin })
  }
>
  {placeBet.isPending ? 'Placing bet…' : account ? `Place ${direction} Bet` : 'Sign in to bet'}
</Button>
<FaucetButton />
```

Note: `pWin` for Quick Bet (Task 6 Step 2) comes from the existing `odds.pUp`: `const pWin = direction === 'UP' ? odds.pUp : 1 - odds.pUp;` — this line already exists in the panel; reuse it.

---

### Task 7: Hand-off verification (user-driven)

- [ ] **Step 1 (user):** Fill `web/.env.local` from `.env.local.example` (Task 0). Restart `pnpm web:dev`.
- [ ] **Step 2 (user):** Demo path: Sign in with Google (top bar) → address chip appears → Quick Bet shows balance 0 → "Get test dUSDC" → balance 10 → Place Bet (small stake, e.g. 1 dUSDC) → first bet shows "Setting up your account…" then success toast → open Explorer link, confirm `place_bet` call and 1% fee transfer to the treasury (`0x7cee…b1a7`).
- [ ] **Step 3 (user):** Strike Studio: move strike ±, place an UP bet at a custom strike. Range bet stays quote-only as designed.
