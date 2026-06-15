import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromB64 } from "@mysten/sui/utils";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SUI_FLAG_ED25519 = 0x00;

export function loadActiveCliKeypair(): {
  keypair: Ed25519Keypair;
  address: string;
} {
  const keystorePath =
    process.env.SUI_KEYSTORE_PATH ||
    join(homedir(), ".sui", "sui_config", "sui.keystore");

  const raw = readFileSync(keystorePath, "utf-8");
  const entries = JSON.parse(raw) as string[];

  for (const entry of entries) {
    const bytes = fromB64(entry);
    if (bytes.length !== 33) continue;
    if (bytes[0] !== SUI_FLAG_ED25519) continue;
    const secretKey = bytes.slice(1);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    const address = keypair.getPublicKey().toSuiAddress();

    const expected = process.env.SIGNER_ADDRESS;
    if (expected && expected.toLowerCase() !== address.toLowerCase()) continue;

    return { keypair, address };
  }

  throw new Error(
    `No matching ed25519 keypair found in ${keystorePath}` +
      (process.env.SIGNER_ADDRESS
        ? ` for SIGNER_ADDRESS=${process.env.SIGNER_ADDRESS}`
        : ""),
  );
}
