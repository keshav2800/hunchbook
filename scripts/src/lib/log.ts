export const step = (n: number, label: string) =>
  console.log(`\n[${n}] ${label}`);

export const ok = (msg: string) => console.log(`    ✓ ${msg}`);
export const info = (msg: string) => console.log(`    • ${msg}`);
export const warn = (msg: string) => console.log(`    ! ${msg}`);
export const fail = (msg: string) => console.error(`    ✗ ${msg}`);

export const digest = (label: string, digest: string) =>
  console.log(`    ↪ ${label}: https://suiscan.xyz/testnet/tx/${digest}`);

export const heading = (msg: string) =>
  console.log(`\n${"=".repeat(60)}\n${msg}\n${"=".repeat(60)}`);
