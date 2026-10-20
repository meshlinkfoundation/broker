import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execFileAsync = promisify(execFile);

const KNOWN_EXTENDERS = [
  { name: "Purple", hostname: "halowlink2-626f", mac: "94:83:c4:82:62:70" },
  { name: "Green", hostname: "halowlink2-8b24", mac: "94:83:c4:95:8b:25" },
  { name: "Red", hostname: "halow-red", mac: "94:83:c4:95:94:41" },
];

interface Lease {
  mac: string;
  ip: string;
  hostname: string;
}

interface Station {
  signalDbm: number;
  snr: number;
  lastHeardSeconds: number;
  txRate: string | null;
}

export interface ExtenderView {
  name: string;
  hostname: string;
  mac: string;
  ip: string | null;
  linked: boolean;
  signalDbm: number | null;
  snr: number | null;
  lastHeardSeconds: number | null;
  txRate: string | null;
}

function readLeases(): Lease[] {
  const leases: Lease[] = [];
  for (const leasePath of ["/var/lib/misc/dnsmasq.leases", "/var/lib/dnsmasq/dnsmasq.leases"]) {
    if (!fs.existsSync(leasePath)) continue;
    for (const line of fs.readFileSync(leasePath, "utf8").split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      leases.push({
        mac: parts[1].toLowerCase(),
        ip: parts[2],
        hostname: parts[3] === "*" ? "" : parts[3],
      });
    }
  }
  return leases;
}

function parseAssocList(text: string): Map<string, Station> {
  const stations = new Map<string, Station>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const header = line.match(/^([0-9A-Fa-f:]{17})\s+(-?\d+) dBm\s+\/\s+-?\d+ dBm \(SNR (\d+)\)\s+(\d+) ms ago/);
    if (header) {
      current = header[1].toLowerCase();
      stations.set(current, {
        signalDbm: Number(header[2]),
        snr: Number(header[3]),
        lastHeardSeconds: Math.round(Number(header[4]) / 1000),
        txRate: null,
      });
      continue;
    }
    const tx = line.match(/TX:\s+([0-9.]+ MBit\/s)/);
    if (tx && current) {
      const station = stations.get(current);
      if (station) station.txRate = tx[1];
    }
  }
  return stations;
}

async function readAssocList(): Promise<Map<string, Station>> {
  const address = process.env.MESHLINK_HALOW_AP || "192.168.50.10";
  const key = process.env.MESHLINK_HALOW_SSH_KEY || "/home/meshlink/.ssh/id_ed25519_halow";
  const { stdout } = await execFileAsync(
    "ssh",
    [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      "-o", "StrictHostKeyChecking=accept-new",
      "-i", key,
      `root@${address}`,
      "iwinfo wlan0 assoclist",
    ],
    { timeout: 8000 },
  );
  return parseAssocList(stdout);
}

export async function getExtenderStatus(): Promise<{
  accessPoint: { name: string; ip: string | null; reachable: boolean };
  extenders: ExtenderView[];
}> {
  const leases = readLeases();
  const leaseByMac = new Map(leases.map((lease) => [lease.mac, lease]));
  let stations = new Map<string, Station>();
  let accessPointReachable = false;
  try {
    stations = await readAssocList();
    accessPointReachable = true;
  } catch (error) {
    console.error("[Extenders] HaLow access point unreachable:", error instanceof Error ? error.message : error);
  }

  const seen = new Set(KNOWN_EXTENDERS.map((unit) => unit.mac));
  const units = [...KNOWN_EXTENDERS];
  if (accessPointReachable) {
    for (const mac of stations.keys()) {
      if (seen.has(mac)) continue;
      const lease = leaseByMac.get(mac);
      if (lease?.hostname === "halow-black") continue;
      units.push({
        name: lease?.hostname || mac,
        hostname: lease?.hostname || "",
        mac,
      });
    }
  }

  const extenders = units.map((unit) => {
    const station = stations.get(unit.mac);
    const lease = leaseByMac.get(unit.mac) || leases.find((item) => item.hostname === unit.hostname);
    // The access point keeps a station in its list for several minutes after it
    // goes away. An idle extender still checks in within about a minute, so
    // anything quieter than that is treated as unlinked.
    const linked = station != null && station.lastHeardSeconds <= 90;
    return {
      name: unit.name,
      hostname: unit.hostname,
      mac: unit.mac,
      ip: lease?.ip || null,
      linked,
      signalDbm: linked ? station.signalDbm : null,
      snr: linked ? station.snr : null,
      lastHeardSeconds: station?.lastHeardSeconds ?? null,
      txRate: linked ? station.txRate : null,
    };
  });

  const blackLease = leases.find((lease) => lease.hostname === "halow-black");
  return {
    accessPoint: {
      name: "Black",
      ip: blackLease?.ip || null,
      reachable: accessPointReachable,
    },
    extenders,
  };
}
