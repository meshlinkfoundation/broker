import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const IP = "/usr/sbin/ip";
const IPTABLES = "/usr/sbin/iptables";
const FWMARK = "0x2121";
export const DEFAULT_ROUTE_TABLE = 2121;

async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args);
  return stdout;
}

async function ip(args: string[]): Promise<string> {
  return run(IP, args);
}

async function iptables(args: string[]): Promise<void> {
  await run(IPTABLES, args);
}

async function hasMarkRule(guestInterface: string): Promise<boolean> {
  try {
    await iptables([
      "-t", "mangle", "-C", "PREROUTING", "-i", guestInterface,
      "-j", "MARK", "--set-xmark", `${FWMARK}/0xffffffff`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function defaultRoute(): Promise<{ via: string; dev: string }> {
  const output = await ip(["route", "show", "default"]);
  const match = output.match(/default via (\S+) dev (\S+)/);
  if (!match) throw new Error("could not find the current default route");
  return { via: match[1], dev: match[2] };
}

function upstreamHost(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  if (!url.hostname) throw new Error(`invalid upstream URL: ${gatewayUrl}`);
  return url.hostname;
}

async function bypassPrefixes(guestInterface: string): Promise<string[]> {
  const output = await ip(["-4", "route", "show"]).catch(() => "");
  const prefixes: string[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+)\s+dev\s+(\S+).*scope link/);
    if (!match) continue;
    const [, prefix, dev] = match;
    if (dev !== guestInterface && prefix !== "default") prefixes.push(prefix);
  }
  return Array.from(new Set(prefixes));
}

async function addBypassRules(guestInterface: string): Promise<void> {
  const rules = await ip(["rule", "show"]);
  for (const prefix of await bypassPrefixes(guestInterface)) {
    if (!rules.includes(`to ${prefix} lookup main`)) {
      await ip(["rule", "add", "to", prefix, "lookup", "main", "pref", "900"]);
    }
  }
}

async function removeBypassRules(guestInterface: string): Promise<void> {
  const rules = await ip(["rule", "show"]).catch(() => "");
  for (const prefix of await bypassPrefixes(guestInterface)) {
    if (rules.includes(`to ${prefix} lookup main`)) {
      await ip(["rule", "del", "to", prefix, "lookup", "main", "pref", "900"]).catch(() => undefined);
    }
  }
}

export async function installUpstreamRoute(
  gatewayUrl: string,
  guestInterface = "br-guest",
  table = DEFAULT_ROUTE_TABLE,
  nexthop = "",
): Promise<void> {
  const host = upstreamHost(gatewayUrl);
  const main = await defaultRoute();

  if (nexthop) {
    await ip(["route", "replace", "table", String(table), "default", "via", nexthop, "dev", main.dev]);
  } else {
    await ip(["route", "replace", "table", String(table), `${host}/32`, "via", main.via, "dev", main.dev, "onlink"]);
    await ip(["route", "replace", "table", String(table), "default", "via", host, "dev", main.dev, "onlink"]);
  }

  if (!(await hasMarkRule(guestInterface))) {
    await iptables([
      "-t", "mangle", "-I", "PREROUTING", "-i", guestInterface,
      "-j", "MARK", "--set-xmark", `${FWMARK}/0xffffffff`,
    ]);
  }

  await addBypassRules(guestInterface);
  const rules = await ip(["rule", "show"]);
  if (!rules.includes(`fwmark ${FWMARK} lookup ${table}`)) {
    await ip(["rule", "add", "fwmark", FWMARK, "lookup", String(table), "pref", "1000"]);
  }
}

export async function removeUpstreamRoute(
  guestInterface = "br-guest",
  table = DEFAULT_ROUTE_TABLE,
): Promise<void> {
  if (await hasMarkRule(guestInterface)) {
    await iptables([
      "-t", "mangle", "-D", "PREROUTING", "-i", guestInterface,
      "-j", "MARK", "--set-xmark", `${FWMARK}/0xffffffff`,
    ]);
  }

  await removeBypassRules(guestInterface);
  const rules = await ip(["rule", "show"]).catch(() => "");
  if (rules.includes(`fwmark ${FWMARK} lookup ${table}`)) {
    await ip(["rule", "del", "fwmark", FWMARK, "lookup", String(table)]).catch(() => undefined);
  }
  await ip(["route", "flush", "table", String(table)]).catch(() => undefined);
}
