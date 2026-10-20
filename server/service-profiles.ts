import fs from "fs";
import path from "path";
import { z } from "zod";

const tierSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().nonnegative().default(0),
  fiatPrice: z.number().nonnegative().optional(),
  dataLimitMB: z.number().int().nonnegative(),
  durationHours: z.number().nonnegative(),
  speedMbps: z.union([z.number().positive(), z.literal("max")]),
  features: z.array(z.string()).optional(),
  buttonText: z.string().optional(),
  buttonColor: z.string().optional(),
  isFree: z.boolean(),
  isPopular: z.boolean().optional(),
  enabled: z.boolean().optional(),
  acceptStripePayments: z.boolean().optional(),
  acceptCryptoPayments: z.boolean().optional(),
}).passthrough();

const profileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1),
  description: z.string().default(""),
  branding: z.object({
    logoText: z.string().optional(),
    tagline: z.string().optional(),
    primaryColor: z.string().optional(),
    secondaryColor: z.string().optional(),
    showCommunityBadge: z.boolean().optional(),
  }).partial().optional(),
  pricing: z.object({
    currency: z.string().optional(),
    fiatCurrency: z.string().optional(),
    tiers: z.array(tierSchema).min(1),
  }),
});

export type ServiceProfile = z.infer<typeof profileSchema>;

const configDirectory = path.join(process.cwd(), "server", "config");
const profilesDirectory = path.join(configDirectory, "profiles");
const activeProfilePath = path.join(configDirectory, "active-profile.json");

function readProfileDocuments(): ServiceProfile[] {
  if (!fs.existsSync(profilesDirectory)) return [];

  const profiles: ServiceProfile[] = [];
  for (const filename of fs.readdirSync(profilesDirectory).sort()) {
    if (!filename.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(profilesDirectory, filename), "utf8"));
      const profile = profileSchema.parse(raw);
      if (profiles.some((candidate) => candidate.id === profile.id)) {
        throw new Error(`Duplicate profile id: ${profile.id}`);
      }
      profiles.push(profile);
    } catch (error) {
      console.error(`[Profiles] Ignoring invalid profile ${filename}:`, error);
    }
  }
  return profiles;
}

export function getActiveProfileId(): string {
  try {
    const state = JSON.parse(fs.readFileSync(activeProfilePath, "utf8"));
    return typeof state.profileId === "string" ? state.profileId : "default";
  } catch {
    return "default";
  }
}

export function resolveServiceProfile(baseConfig: any): any {
  const requestedId = getActiveProfileId();
  if (requestedId === "default") {
    return {
      ...baseConfig,
      serviceProfile: {
        id: "default",
        name: "Default Node Configuration",
        description: "Pricing and branding from the base node configuration",
      },
    };
  }

  const profile = readProfileDocuments().find((candidate) => candidate.id === requestedId);
  if (!profile) {
    console.warn(`[Profiles] Active profile '${requestedId}' is unavailable; using default`);
    return {
      ...baseConfig,
      serviceProfile: {
        id: "default",
        name: "Default Node Configuration",
        description: "Pricing and branding from the base node configuration",
      },
    };
  }

  return {
    ...baseConfig,
    nodeInfo: {
      ...baseConfig.nodeInfo,
      name: profile.branding?.logoText?.trim() || profile.name,
    },
    branding: {
      ...baseConfig.branding,
      ...profile.branding,
      logoText: profile.branding?.logoText?.trim() || profile.name,
    },
    pricing: {
      ...baseConfig.pricing,
      ...profile.pricing,
      tiers: profile.pricing.tiers,
    },
    serviceProfile: {
      id: profile.id,
      name: profile.name,
      description: profile.description,
    },
  };
}

export function listServiceProfiles(baseConfig: any) {
  const profiles = readProfileDocuments();
  const requestedProfileId = getActiveProfileId();
  const activeProfileId = requestedProfileId === "default" || profiles.some((profile) => profile.id === requestedProfileId)
    ? requestedProfileId
    : "default";
  const defaultProfile = {
    id: "default",
    name: "Default Node Configuration",
    description: "Pricing and branding from the base node configuration",
    branding: baseConfig.branding || {},
    pricing: baseConfig.pricing,
  };

  return {
    activeProfileId,
    profiles: [defaultProfile, ...profiles].map((profile) => ({
      ...profile,
      isActive: profile.id === activeProfileId,
      tierCount: profile.pricing?.tiers?.filter((tier: any) => tier.enabled !== false).length || 0,
    })),
  };
}

export function activateServiceProfile(profileId: string, baseConfig: any) {
  if (profileId !== "default") {
    const available = readProfileDocuments().some((profile) => profile.id === profileId);
    if (!available) throw new Error(`Unknown service profile: ${profileId}`);
  }

  const temporaryPath = `${activeProfilePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ profileId }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, activeProfilePath);

  return listServiceProfiles(baseConfig);
}
