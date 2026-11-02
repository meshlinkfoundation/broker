import crypto from "crypto";
import fs from "fs";
import path from "path";
import { finalizeEvent, getPublicKey } from "nostr-tools";

export interface TollgateIdentity {
  secretKey: Uint8Array;
  pubkey: string;
  path: string;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("identity secret key must be 32-byte hex");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function loadIdentity(dataDir: string): TollgateIdentity {
  const dir = path.resolve(process.cwd(), dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const identityPath = path.join(dir, "identity.json");

  let secretHex = process.env.MESHLINK_TOLLGATE_SECRET_KEY || "";
  if (!secretHex && fs.existsSync(identityPath)) {
    const stored = JSON.parse(fs.readFileSync(identityPath, "utf8"));
    secretHex = String(stored.secretKey || "");
  }
  if (!secretHex) {
    secretHex = crypto.randomBytes(32).toString("hex");
  }

  const secretKey = hexToBytes(secretHex);
  const pubkey = getPublicKey(secretKey);

  if (!fs.existsSync(identityPath)) {
    fs.writeFileSync(
      identityPath,
      JSON.stringify({ secretKey: secretHex, pubkey }, null, 2) + "\n",
      { mode: 0o600 },
    );
  } else {
    fs.chmodSync(identityPath, 0o600);
  }

  return { secretKey, pubkey, path: identityPath };
}

export function signEvent(
  identity: TollgateIdentity,
  template: { kind: number; created_at?: number; tags: string[][]; content?: string },
) {
  return finalizeEvent(
    {
      kind: template.kind,
      created_at: template.created_at ?? Math.floor(Date.now() / 1000),
      tags: template.tags,
      content: template.content ?? "",
    },
    identity.secretKey,
  );
}
