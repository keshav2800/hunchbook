'use client';

import { useState } from 'react';
import { Camera, TriangleAlert } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AddressAvatar } from '@/components/account/address-avatar';
import { ConnectButton } from '@/components/auth/connect-button';
import { StatsStrip } from '@/components/bets/stats-strip';
import { shortAddress } from '@/lib/format';
import { BIO_MAX, validateProfile } from '@/lib/profile-validation';
import { useGoogleClaims, useMyProfile, useUpdateProfile } from '@/lib/use-profile';

export default function ProfilePage() {
  const account = useCurrentAccount();
  const profile = useMyProfile();
  const claims = useGoogleClaims();
  const update = useUpdateProfile();

  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [touched, setTouched] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Email is not editable: it comes from the Google sign-in (stored copy
  // first, live Google claim as fallback for pre-fix profiles).
  const email = profile.data?.email || claims.data?.email || '';

  // Seed the form when the (signed) profile read lands — render-time state
  // adjustment per React's "derived state" pattern; never clobbers edits.
  if (profile.data && !seeded) {
    setSeeded(true);
    setUsername(profile.data.username ?? '');
    setBio(profile.data.bio ?? '');
  }

  if (!account) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">Sign in to set up your profile.</p>
          <ConnectButton />
        </CardContent>
      </Card>
    );
  }

  const error = touched ? validateProfile({ username, email, bio }) : null;
  const canSave = !update.isPending && username.length > 0 && !error;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="group relative">
              <AddressAvatar address={account.address} className="size-16" />
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="size-5 text-muted-foreground" />
              </div>
            </div>
            <div>
              <p className="font-mono text-sm">{shortAddress(account.address)}</p>
              <p className="text-xs text-muted-foreground">Photo upload coming soon</p>
            </div>
          </div>

          {profile.isError ? (
            <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              <TriangleAlert className="size-4 shrink-0" />
              Couldn’t load your saved profile: {profile.error.message}. You can still edit and
              save below.
            </div>
          ) : null}
          {profile.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="username">
                  Username
                </label>
                <Input
                  id="username"
                  placeholder="e.g. satoshi_predictor"
                  value={username}
                  onChange={(e) => {
                    setTouched(true);
                    setUsername(e.target.value);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Public — shown on the leaderboard instead of your address.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="email">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  placeholder="Sign in again to link your Google email"
                  disabled
                  className="opacity-70"
                />
                <p className="text-xs text-muted-foreground">
                  From your Google sign-in — it can’t be changed here. Private; used for
                  settlement alerts later.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="bio">
                  Bio <span className="text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  id="bio"
                  rows={3}
                  maxLength={BIO_MAX}
                  placeholder="Up only. Ask me about my win rate."
                  value={bio}
                  onChange={(e) => {
                    setTouched(true);
                    setBio(e.target.value);
                  }}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <p className="text-right text-xs text-muted-foreground">
                  {bio.length}/{BIO_MAX}
                </p>
              </div>

              {error ? <p className="text-sm text-warning">{error}</p> : null}

              <Button
                className="w-full"
                disabled={!canSave}
                onClick={() => update.mutate({ username: username.trim(), email, bio: bio.trim() })}
              >
                {update.isPending ? 'Signing & saving…' : 'Save profile'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Saving signs a message with your wallet to prove the address is yours.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Your record
        </p>
        <StatsStrip />
      </div>
    </div>
  );
}
