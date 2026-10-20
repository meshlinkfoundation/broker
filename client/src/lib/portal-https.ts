export interface PortalHttpsInfo {
  enabled?: boolean;
  trusted?: boolean;
  host?: string;
  url?: string;
}

export function portalHttpsUpgradeUrl(
  https: PortalHttpsInfo | undefined,
  location: Pick<Location, "protocol" | "pathname" | "search" | "hash"> = window.location,
): string | null {
  if (!https?.enabled || !https.trusted || !https.url) return null;
  if (location.protocol === "https:") return null;
  // The operator dashboard is deliberately served only on the private LAN.
  // Do not send it to the guest portal hostname, which resolves to the AP IP.
  if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) return null;
  try {
    const dest = new URL(https.url);
    dest.pathname = location.pathname;
    dest.search = location.search;
    dest.hash = location.hash;
    return dest.toString();
  } catch {
    return null;
  }
}
