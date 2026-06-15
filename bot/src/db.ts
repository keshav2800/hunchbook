/**
 * SQLite persistence for the bot. Single file, WAL mode, run idempotent
 * migrations on open. better-sqlite3 is synchronous — perfect for grammY's
 * async handlers since queries are sub-millisecond.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface UserRow {
  telegram_id: number;
  sui_address: string;
  secret_key_enc: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  manager_id: string | null;
  created_at: number;
}

export interface AutopilotRow {
  telegram_id: number;
  vibe: string;
  side: string;
  amount_raw: number;
  asset: string;
  interval_ms: number;
  budget_raw: number;
  spent_raw: number;
  last_run_at: number | null;
  active: number;
  created_at: number;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users (
    telegram_id     INTEGER PRIMARY KEY,
    sui_address     TEXT NOT NULL UNIQUE,
    secret_key_enc  BLOB NOT NULL,
    iv              BLOB NOT NULL,
    auth_tag        BLOB NOT NULL,
    manager_id      TEXT,
    created_at      INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_sui_address ON users(sui_address)`,
  // One autopilot config per user. Background loop reads active rows every 60s
  // and fires a bet if (now - last_run_at) ≥ interval_ms and budget remains.
  `CREATE TABLE IF NOT EXISTS autopilots (
    telegram_id     INTEGER PRIMARY KEY,
    vibe            TEXT NOT NULL,
    side            TEXT NOT NULL,
    amount_raw      INTEGER NOT NULL,
    asset           TEXT NOT NULL DEFAULT 'BTC',
    interval_ms     INTEGER NOT NULL,
    budget_raw      INTEGER NOT NULL,
    spent_raw       INTEGER NOT NULL DEFAULT 0,
    last_run_at     INTEGER,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  )`,
];

export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const sql of MIGRATIONS) db.exec(sql);

  const insertUser = db.prepare<
    [number, string, Buffer, Buffer, Buffer, number]
  >(
    `INSERT INTO users
       (telegram_id, sui_address, secret_key_enc, iv, auth_tag, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const getUserByTelegramId = db.prepare<[number], UserRow>(
    `SELECT * FROM users WHERE telegram_id = ?`,
  );
  const setManagerId = db.prepare<[string, number]>(
    `UPDATE users SET manager_id = ? WHERE telegram_id = ?`,
  );

  const upsertAutopilot = db.prepare<
    [number, string, string, number, string, number, number, number]
  >(
    `INSERT INTO autopilots
       (telegram_id, vibe, side, amount_raw, asset, interval_ms, budget_raw, created_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(telegram_id) DO UPDATE SET
       vibe = excluded.vibe,
       side = excluded.side,
       amount_raw = excluded.amount_raw,
       asset = excluded.asset,
       interval_ms = excluded.interval_ms,
       budget_raw = excluded.budget_raw,
       spent_raw = 0,
       last_run_at = NULL,
       active = 1`,
  );
  const getAutopilot = db.prepare<[number], AutopilotRow>(
    `SELECT * FROM autopilots WHERE telegram_id = ?`,
  );
  const listActiveAutopilots = db.prepare<[], AutopilotRow>(
    `SELECT * FROM autopilots WHERE active = 1`,
  );
  const setAutopilotActive = db.prepare<[number, number]>(
    `UPDATE autopilots SET active = ? WHERE telegram_id = ?`,
  );
  const recordAutopilotRun = db.prepare<[number, number, number]>(
    `UPDATE autopilots SET last_run_at = ?, spent_raw = spent_raw + ? WHERE telegram_id = ?`,
  );

  return {
    db,
    insertUser: (
      telegram_id: number,
      sui_address: string,
      secret_key_enc: Buffer,
      iv: Buffer,
      auth_tag: Buffer,
    ) =>
      insertUser.run(
        telegram_id,
        sui_address,
        secret_key_enc,
        iv,
        auth_tag,
        Date.now(),
      ),
    getUserByTelegramId: (telegram_id: number) =>
      getUserByTelegramId.get(telegram_id) as UserRow | undefined,
    setManagerId: (telegram_id: number, manager_id: string) =>
      setManagerId.run(manager_id, telegram_id),
    upsertAutopilot: (args: {
      telegram_id: number;
      vibe: string;
      side: string;
      amount_raw: number;
      asset: string;
      interval_ms: number;
      budget_raw: number;
    }) =>
      upsertAutopilot.run(
        args.telegram_id,
        args.vibe,
        args.side,
        args.amount_raw,
        args.asset,
        args.interval_ms,
        args.budget_raw,
        Date.now(),
      ),
    getAutopilot: (telegram_id: number) =>
      getAutopilot.get(telegram_id) as AutopilotRow | undefined,
    listActiveAutopilots: () => listActiveAutopilots.all() as AutopilotRow[],
    setAutopilotActive: (telegram_id: number, active: boolean) =>
      setAutopilotActive.run(active ? 1 : 0, telegram_id),
    recordAutopilotRun: (telegram_id: number, spent_raw: number) =>
      recordAutopilotRun.run(Date.now(), spent_raw, telegram_id),
    close: () => db.close(),
  };
}

export type BotDb = ReturnType<typeof openDb>;
