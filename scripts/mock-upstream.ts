import express from "express";
import fs from "fs";
import { createAdvertisement, createSessionNotice } from "../server/tollgate/advertisement";
import { loadIdentity } from "../server/tollgate/identity";
import { CashuReceiver } from "../server/tollgate/cashu";

const mintUrl = process.env.MESHLINK_MINT_URL || "http://10.99.98.2:8383";
const dataDir = process.env.MESHLINK_MOCK_DATA_DIR || "/tmp/meshlink-mock-upstream";
const port = Number(process.env.MESHLINK_MOCK_PORT || 2121);
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

const identity = loadIdentity(dataDir);
const receiver = new CashuReceiver(mintUrl);
const config: any = {
  metric: "milliseconds",
  stepSize: 60_000,
  pricePerStep: 1,
  unit: "sat",
  mintUrl,
  minSteps: 1,
  tips: [],
};

const app = express();
app.get("/", (_req, res) => res.json(createAdvertisement(config, identity)));
app.get("/usage", (_req, res) => res.type("text/plain").send("-1/-1"));
app.post("/", express.text({ type: () => true }), async (req, res) => {
  try {
    const payment = await receiver.receive(String(req.body || "").trim());
    console.log(`[mock-upstream] paid ${payment.amount} sat`);
    res.json(
      createSessionNotice(identity, {
        mac: "02:00:00:00:00:01",
        allotment: 60_000,
        metric: "milliseconds",
        mintUrl,
      }),
    );
  } catch (error) {
    console.error("[mock-upstream] payment refused:", error);
    res.status(400).json({ error: String(error) });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[mock-upstream] kind:10021 seller on :${port}, mint ${mintUrl}`);
});
