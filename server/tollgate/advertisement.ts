import type { TollgateConfig } from "./config";
import { signEvent, type TollgateIdentity } from "./identity";

export const ADVERTISEMENT_KIND = 10021;
export const SESSION_KIND = 1022;
export const NOTICE_KIND = 21023;

export function createAdvertisement(config: TollgateConfig, identity: TollgateIdentity) {
  const tags: string[][] = [
    ["metric", config.metric],
    ["step_size", String(config.stepSize)],
    ["tips", ...config.tips],
    [
      "price_per_step",
      "cashu",
      String(config.pricePerStep),
      config.unit,
      config.mintUrl,
      String(config.minSteps),
    ],
  ];

  return signEvent(identity, {
    kind: ADVERTISEMENT_KIND,
    tags,
    content: "",
  });
}

export function createSessionNotice(
  identity: TollgateIdentity,
  opts: {
    mac: string;
    allotment: number;
    metric: string;
    mintUrl: string;
  },
) {
  return signEvent(identity, {
    kind: SESSION_KIND,
    tags: [
      ["device-identifier", "mac"],
      ["device-mac", opts.mac],
      ["allotment", String(opts.allotment)],
      ["metric", opts.metric],
      ["mint", opts.mintUrl],
    ],
    content: "",
  });
}

export function createErrorNotice(
  identity: TollgateIdentity,
  code: string,
  message: string,
  level = "error",
) {
  return signEvent(identity, {
    kind: NOTICE_KIND,
    tags: [
      ["level", level],
      ["code", code],
      ["message", message],
    ],
    content: message,
  });
}
