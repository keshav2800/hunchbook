/*
 * Write access to a profile requires proof of address ownership: the client
 * signs a canonical message with their (zkLogin) wallet, and we verify it
 * against the claimed address. zkLogin signature verification needs a chain
 * client (it checks the proof against current epoch data).
 */
import { SuiClient } from '@mysten/sui/client';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { SUI_FULLNODE_URL } from '@hunchbook/shared';

const MAX_AGE_MS = 5 * 60_000;

export const profileWriteMessage = (
  timestamp: number,
  username: string,
  email: string,
  bio: string,
): string => `Hunchbook:profile:v1:${timestamp}:${username}:${email}:${bio}`;

export const profileReadMessage = (timestamp: number): string =>
  `Hunchbook:profile:read:v1:${timestamp}`;

export function timestampFresh(timestamp: number): boolean {
  return Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= MAX_AGE_MS;
}

export async function verifyOwnership(
  message: string,
  signature: string,
  address: string,
): Promise<boolean> {
  try {
    const client = new SuiClient({ url: SUI_FULLNODE_URL });
    await verifyPersonalMessageSignature(new TextEncoder().encode(message), signature, {
      address,
      client,
    });
    return true;
  } catch {
    return false;
  }
}
