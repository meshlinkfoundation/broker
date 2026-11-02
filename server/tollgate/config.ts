import fs from "fs";
import path from "path";

export type TollgateMetric = "milliseconds" | "bytes";

export interface TollgateConfig {
  enabled: boolean;
  metric: TollgateMetric;
  stepSize: number;
  pricePerStep: number;
  unit: string;
  mintUrl: string;
  minSteps: number;
  maxSteps: number;
  deviceIdentifier: string;
  tips: string[];
  port: number;
  dataDir: string;
}

const DEFAULTS: TollgateConfig = {
  enabled: true,
  metric: "milliseconds",
  stepSize: 600_000,
  pricePerStep: 1,
  unit: "sat",
  mintUrl: "http://10.99.98.2:8383",
  minSteps: 1,
  maxSteps: 100,
  deviceIdentifier: "mac",
  tips: [],
  port: 2121,
  dataDir: "server/data",
};

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function mintHostPort(mintUrl: string): { host: string; port: number } {
  const parsed = new URL(mintUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
  };
}

export function loadTollgateConfig(): TollgateConfig {
  let fileConfig: any = {};
  try {
    const configPath = path.join(process.cwd(), "server", "config", "meshlink-config.json");
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8")).tollgate ?? {};
  } catch (error) {
    console.error("[Tollgate] config load failed; using defaults:", error);
  }

  const metric = fileConfig.metric === "bytes" ? "bytes" : "milliseconds";
  const mintUrl = normalizeUrl(
    process.env.MESHLINK_MINT_URL || fileConfig.mintUrl || DEFAULTS.mintUrl,
  );
  const port = positiveInt(process.env.TOLLGATE_PORT || fileConfig.port, DEFAULTS.port);
  const enabled = String(process.env.MESHLINK_TOLLGATE_ENABLED ?? fileConfig.enabled ?? true) !== "false";

  return {
    enabled,
    metric,
    stepSize: positiveInt(fileConfig.stepSize, DEFAULTS.stepSize),
    pricePerStep: positiveInt(fileConfig.pricePerStep, DEFAULTS.pricePerStep),
    unit: String(fileConfig.unit || DEFAULTS.unit),
    mintUrl,
    minSteps: positiveInt(fileConfig.minSteps, DEFAULTS.minSteps),
    maxSteps: positiveInt(fileConfig.maxSteps, DEFAULTS.maxSteps),
    deviceIdentifier: String(fileConfig.deviceIdentifier || DEFAULTS.deviceIdentifier),
    tips: Array.isArray(fileConfig.tips) ? fileConfig.tips.map(String) : DEFAULTS.tips,
    port,
    dataDir: process.env.MESHLINK_TOLLGATE_DATA_DIR || fileConfig.dataDir || DEFAULTS.dataDir,
  };
}
