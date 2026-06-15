'use client';

import { useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConnectButton } from '@/components/auth/connect-button';
import { formatNumber } from '@/lib/format';
import { useDusdcBalance } from '@/lib/use-place-bet';
import { useVaultDeposit, useVaultStats, useVaultWithdraw } from '@/lib/use-vault';

const DUSDC_SCALE = 1e6;

function AmountRow({
  amount,
  onAmount,
  onMax,
  hint,
}: {
  amount: string;
  onAmount: (v: string) => void;
  onMax: () => void;
  hint: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
        />
        <Button variant="outline" onClick={onMax}>
          Max
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function DepositWithdraw() {
  const account = useCurrentAccount();
  const balance = useDusdcBalance();
  const stats = useVaultStats();
  const deposit = useVaultDeposit();
  const withdraw = useVaultWithdraw();
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const sharePrice = stats.data?.sharePrice ?? 1;
  const userShares = stats.data?.userShares ?? 0;
  const positionUsd = stats.data?.userPositionUsd ?? 0;

  const parsedDeposit = Number(depositAmount);
  const parsedWithdraw = Number(withdrawAmount);
  const withdrawIsMax = parsedWithdraw > 0 && Math.abs(parsedWithdraw - positionUsd) < 0.01;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage Position</CardTitle>
      </CardHeader>
      <CardContent>
        {!account ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">Sign in to deposit into the vault.</p>
            <ConnectButton />
          </div>
        ) : (
          <Tabs defaultValue="deposit">
            <TabsList className="w-full">
              <TabsTrigger value="deposit" className="flex-1">
                Deposit
              </TabsTrigger>
              <TabsTrigger value="withdraw" className="flex-1">
                Withdraw
              </TabsTrigger>
            </TabsList>

            <TabsContent value="deposit" className="space-y-4 pt-4">
              <AmountRow
                amount={depositAmount}
                onAmount={setDepositAmount}
                onMax={() => setDepositAmount(String(balance.data ?? 0))}
                hint={`Wallet: ${formatNumber(balance.data ?? 0)} dUSDC`}
              />
              <Button
                className="w-full"
                disabled={deposit.isPending || !(parsedDeposit > 0)}
                onClick={() =>
                  deposit.mutate(parsedDeposit, { onSuccess: () => setDepositAmount('') })
                }
              >
                {deposit.isPending ? 'Depositing…' : 'Deposit dUSDC'}
              </Button>
            </TabsContent>

            <TabsContent value="withdraw" className="space-y-4 pt-4">
              <AmountRow
                amount={withdrawAmount}
                onAmount={setWithdrawAmount}
                onMax={() => setWithdrawAmount(positionUsd.toFixed(2))}
                hint={`Your position: ${formatNumber(positionUsd)} dUSDC (${formatNumber(userShares)} shares)`}
              />
              <Button
                className="w-full"
                variant="secondary"
                disabled={withdraw.isPending || !(parsedWithdraw > 0)}
                onClick={() => {
                  // "Max" burns the exact share balance — no rounding dust left behind.
                  const sharesRaw = withdrawIsMax
                    ? BigInt(Math.round(userShares * DUSDC_SCALE))
                    : BigInt(Math.floor((parsedWithdraw / sharePrice) * DUSDC_SCALE));
                  withdraw.mutate(
                    { sharesRaw, estUsd: parsedWithdraw },
                    { onSuccess: () => setWithdrawAmount('') },
                  );
                }}
              >
                {withdraw.isPending ? 'Withdrawing…' : 'Withdraw dUSDC'}
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
