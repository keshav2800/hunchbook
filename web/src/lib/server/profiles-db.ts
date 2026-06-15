import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface ProfileRow {
  address: string;
  username: string;
  email: string;
  bio: string;
  updated_at: number;
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    const dir = path.join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    db = new Database(path.join(dir, 'profiles.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        address TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username
        ON profiles (lower(username));
    `);
  }
  return db;
}

export function getProfile(address: string): ProfileRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM profiles WHERE address = ?')
      .get(address) as ProfileRow | undefined) ?? null
  );
}

/** Public usernames for a batch of addresses (missing entries omitted). */
export function getUsernames(addresses: string[]): Record<string, string> {
  if (addresses.length === 0) return {};
  const placeholders = addresses.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT address, username FROM profiles WHERE address IN (${placeholders})`)
    .all(...addresses) as { address: string; username: string }[];
  return Object.fromEntries(rows.map((r) => [r.address, r.username]));
}

export function upsertProfile(p: {
  address: string;
  username: string;
  email: string;
  bio: string;
}): 'ok' | 'username_taken' {
  const database = getDb();
  const clash = database
    .prepare('SELECT address FROM profiles WHERE lower(username) = lower(?) AND address != ?')
    .get(p.username, p.address);
  if (clash) return 'username_taken';
  database
    .prepare(
      `INSERT INTO profiles (address, username, email, bio, updated_at)
       VALUES (@address, @username, @email, @bio, @updated_at)
       ON CONFLICT(address) DO UPDATE SET
         username = excluded.username,
         -- Email is set once (from Google sign-in) and then immutable.
         email = CASE WHEN profiles.email != '' THEN profiles.email ELSE excluded.email END,
         bio = excluded.bio,
         updated_at = excluded.updated_at`,
    )
    .run({ ...p, updated_at: Date.now() });
  return 'ok';
}
