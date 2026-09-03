import { readFileSync } from "node:fs";
import { AwsClient } from "aws4fetch";
const env = Object.fromEntries(
  readFileSync(".env.production.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);
const c = new AwsClient({
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: env.S3_REGION || "auto",
});
const base = `${env.R2_ENDPOINT.replace(/\/$/, "")}/${env.R2_BUCKET}`;
const GALLERY = "galleries/5cceddcfb0286547ba2024340339dc63";

async function list(prefix) {
  const keys = [];
  let token;
  do {
    const u = new URL(base);
    u.searchParams.set("list-type", "2");
    u.searchParams.set("prefix", prefix);
    u.searchParams.set("max-keys", "1000");
    if (token) u.searchParams.set("continuation-token", token);
    const x = await (await c.fetch(u.toString())).text();
    keys.push(...[...x.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]));
    token = /<NextContinuationToken>([^<]+)</.exec(x)?.[1];
  } while (token);
  return keys;
}
const ts = () => new Date().toISOString().slice(11, 19);
let prev = "";
const deadline = Date.now() + 40 * 60_000;

while (Date.now() < deadline) {
  try {
    const tracking = await list("_zip-builds/");
    const manifests = tracking.filter((k) => k.endsWith(".json"));
    const parts = tracking.filter((k) => k.includes("/parts/")).length;
    const archive = await list(`${GALLERY}/_archive.zip`);

    if (archive.length) {
      const head = await c.fetch(
        `${base}/${GALLERY.split("/").map(encodeURIComponent).join("/")}/_archive.zip`,
        { method: "HEAD" },
      );
      console.log(
        `${ts()} DONE archive exists, ${(Number(head.headers.get("content-length")) / 1048576).toFixed(0)} MB, ${head.headers.get("content-disposition")}`,
      );
      break;
    }
    const state = manifests.length
      ? `building: ${manifests.length} manifest(s), ${parts} parts uploaded`
      : "idle: no build in flight";
    if (state !== prev) {
      console.log(`${ts()} ${state}`);
      prev = state;
    }
  } catch (e) {
    console.log(`${ts()} poll error: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 45_000));
}
console.log(`${ts()} watch finished`);
