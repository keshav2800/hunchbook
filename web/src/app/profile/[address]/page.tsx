'use client';

import { useParams } from 'next/navigation';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Card, CardContent } from '@/components/ui/card';
import { StatsStrip } from '@/components/bets/stats-strip';
import { ProfileIdentityCard } from '@/components/profile/profile-identity-card';
import { PnlCard } from '@/components/profile/pnl-card';
import { usePublicProfile } from '@/lib/use-profile';

export default function PublicProfilePage() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const account = useCurrentAccount();
  const profile = usePublicProfile(address);

  if (!address?.startsWith('0x')) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          That doesn’t look like a valid wallet address.
        </CardContent>
      </Card>
    );
  }

  const owner = account?.address === address;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileIdentityCard
          address={address}
          owner={owner}
          username={profile.data?.username}
          views={profile.data?.views}
          createdAt={profile.data?.createdAt}
          metaPending={profile.isPending}
        />
        <PnlCard address={address} />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {owner ? 'Your record' : 'Record'}
        </p>
        <StatsStrip address={address} />
      </div>
    </div>
  );
}
