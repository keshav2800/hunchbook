'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentAccount, useCurrentWallet, useSignPersonalMessage } from '@mysten/dapp-kit';
import { getSession, isEnokiWallet } from '@mysten/enoki';
import { toast } from 'sonner';
import type { ProfileFields } from '@/lib/profile-validation';

export interface OwnProfile extends ProfileFields {
  address: string;
}

export interface PublicProfile {
  address: string;
  username: string;
  bio: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${res.url} → ${res.status}`);
  return json;
}

const encode = (s: string) => new TextEncoder().encode(s);

/** Owner's full profile — signs a read message once per page visit. */
export function useMyProfile() {
  const account = useCurrentAccount();
  const { mutateAsync: sign } = useSignPersonalMessage();
  return useQuery({
    queryKey: ['my-profile', account?.address],
    queryFn: async (): Promise<Partial<OwnProfile>> => {
      const timestamp = Date.now();
      const { signature } = await sign({
        message: encode(`Hunchbook:profile:read:v1:${timestamp}`),
      });
      const res = await fetch('/api/profile/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account!.address, timestamp, signature }),
      });
      return jsonOrThrow<Partial<OwnProfile>>(res);
    },
    enabled: !!account,
    staleTime: Infinity, // refreshed explicitly on save
    retry: 1,
  });
}

/** Core sign-and-save used by both the form and first-sign-in auto-provisioning. */
function useProfileSaver() {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const { mutateAsync: sign } = useSignPersonalMessage();

  return async (fields: ProfileFields): Promise<OwnProfile> => {
    if (!account) throw new Error('Sign in first.');
    const timestamp = Date.now();
    const message = `Hunchbook:profile:v1:${timestamp}:${fields.username}:${fields.email}:${fields.bio}`;
    const { signature } = await sign({ message: encode(message) });
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: account.address, ...fields, timestamp, signature }),
    });
    const profile = await jsonOrThrow<OwnProfile>(res);
    queryClient.setQueryData(['my-profile', profile.address], profile);
    queryClient.invalidateQueries({ queryKey: ['usernames'] });
    return profile;
  };
}

export function useUpdateProfile() {
  const save = useProfileSaver();
  return useMutation({
    mutationFn: save,
    onSuccess: () => toast.success('Profile saved'),
    onError: (e) => toast.error(e.message),
  });
}

/** Google identity claims from the Enoki zkLogin session's id-token. */
export function useGoogleClaims() {
  const { currentWallet } = useCurrentWallet();
  const account = useCurrentAccount();
  return useQuery({
    queryKey: ['google-claims', account?.address],
    queryFn: async (): Promise<{ email: string | null; name: string | null }> => {
      if (!currentWallet || !isEnokiWallet(currentWallet)) return { email: null, name: null };
      const session = await getSession(currentWallet);
      if (!session?.jwt) return { email: null, name: null };
      try {
        const payload = JSON.parse(atob(session.jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
          email?: string;
          name?: string;
        };
        return { email: payload.email ?? null, name: payload.name ?? null };
      } catch {
        return { email: null, name: null };
      }
    },
    enabled: !!account && !!currentWallet,
    staleTime: Infinity,
  });
}

/** "keshav.g@gmail.com" → "keshav_g" (valid, 3–20 chars). */
export function usernameFromEmail(email: string): string {
  let base = email.split('@')[0]!.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (base.length < 3) base = `${base}_predictor`.slice(0, 20).replace(/^_/, 'p');
  return base.slice(0, 20);
}

/**
 * First sign-in auto-provisioning: if this address has no profile yet, derive
 * a username from the Google email and save it silently. The user can change
 * it any time on /profile.
 */
export function useAutoProvisionProfile() {
  const account = useCurrentAccount();
  const claims = useGoogleClaims();
  const existing = useUsernames(account ? [account.address] : []);
  const save = useProfileSaver();
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    const address = account?.address;
    const email = claims.data?.email;
    if (!address || !email || !existing.isSuccess) return;
    if (existing.data[address]) return; // already has a profile
    if (attempted.current === address) return; // one shot per address per session
    attempted.current = address;

    void (async () => {
      const base = usernameFromEmail(email);
      const candidates = [base, `${base.slice(0, 15)}_${Math.floor(Math.random() * 900 + 100)}`];
      for (const username of candidates) {
        try {
          const saved = await save({ username, email, bio: '' });
          toast.success(`Welcome, ${saved.username}!`, {
            description: 'Username auto-assigned from your Google account — change it in Profile.',
          });
          return;
        } catch (e) {
          if (e instanceof Error && e.message.includes('taken')) continue;
          return; // signing declined / network issue — stay quiet, /profile still works
        }
      }
    })();
  }, [account?.address, claims.data?.email, existing.isSuccess, existing.data, account, save]);
}

/** Public usernames for a set of addresses (leaderboard, stats dialog). */
export function useUsernames(addresses: string[]) {
  const key = [...addresses].sort().join(',');
  return useQuery({
    queryKey: ['usernames', key],
    queryFn: async (): Promise<Record<string, string>> => {
      const res = await fetch(`/api/profiles?addresses=${key}`);
      const json = await jsonOrThrow<{ usernames: Record<string, string> }>(res);
      return json.usernames;
    },
    enabled: addresses.length > 0,
    staleTime: 60_000,
  });
}
