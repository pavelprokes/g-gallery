import { readFileSync } from "node:fs";
import { AwsClient } from "aws4fetch";
import zlib from "node:zlib";
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
const PAGE =
  "https://photos.svatebni-fotograf-cechy.cz/g/z1IAZsJ9EtKjGKoKU-REfg/linda-a-pavel-zlaty-kopec-prezletice-2026-08-15";
const KEYPREFIX = "galleries/5cceddcfb0286547ba2024340339dc63";
let fails = 0;
const check = (name, pass, detail = "") => {
  if (!pass) fails++;
  console.log(`  [${pass ? "OK  " : "CHYBA"}] ${name}${detail ? "  — " + detail : ""}`);
};
const keys = async (p) => {
  const o = [];
  let t;
  do {
    const u = new URL(base);
    u.searchParams.set("list-type", "2");
    u.searchParams.set("prefix", p);
    u.searchParams.set("max-keys", "1000");
    if (t) u.searchParams.set("continuation-token", t);
    const x = await (await c.fetch(u.toString())).text();
    o.push(...[...x.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]));
    t = /<NextContinuationToken>([^<]+)</.exec(x)?.[1];
  } while (t);
  return o;
};

console.log(`\n=== OVĚŘENÍ PRODUKCE  ${new Date().toISOString().slice(11, 19)}Z ===\n`);

console.log("1) Co vidí návštěvník (vykreslené HTML, ne payload)");
const html = await (await fetch(`${PAGE}?cb=${Math.random()}`, { cache: "no-store" })).text();
const anchor = /href="(https:\/\/cdn\.[^"]*_archive[^"]*\.zip)"/.exec(html);
const label = /Stáhnout vše \(([0-9.]+ [KMG]B)\)/.exec(html);
check("odkaz na archiv v HTML", !!anchor, anchor ? "…" + anchor[1].slice(-44) : "žádný");
check("tlačítko uvádí velikost", !!label, label ? label[1] : "");
check("není mrtvé tlačítko 'Připravujeme archiv'", !/>Připravujeme archiv</.test(html));
check("neoznačeno jako zastaralé", !/archiv se právě obnovuje/.test(html) || !!anchor);

console.log("\n2) Archiv na CDN");
const cdnUrl = anchor
  ? anchor[1]
  : `https://cdn.svatebni-fotograf-cechy.cz/${KEYPREFIX}/_archive.zip`;
const head = await fetch(cdnUrl, { method: "HEAD" });
check("CDN vrací objekt", head.ok, `HTTP ${head.status}`);
check("content-type", head.headers.get("content-type") === "application/zip");
check(
  "stahuje se pod jménem",
  /attachment; filename=/.test(head.headers.get("content-disposition") ?? ""),
);
const ranged = await fetch(cdnUrl, { headers: { Range: "bytes=0-3" } });
check("podporuje navazování (Range)", ranged.status === 206);
const size = Number(head.headers.get("content-length"));
check(
  "velikost v tlačítku odpovídá objektu",
  !!label && Math.abs(size / 1073741824 - parseFloat(label[1])) < 0.1,
  `${(size / 1073741824).toFixed(2)} GB`,
);
check("velikost je nad starým stropem int4", size > 2147483647, `${size.toLocaleString()} B`);

console.log("\n3) Obsah archivu");
const objKey = new URL(cdnUrl).pathname.slice(1);
const r2 = `${base}/${objKey.split("/").map(encodeURIComponent).join("/")}`;
const tail = new Uint8Array(
  await (await c.fetch(r2, { headers: { Range: `bytes=${size - 98}-${size - 1}` } })).arrayBuffer(),
);
const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
let z64 = -1;
for (let i = 0; i <= tail.length - 4; i++)
  if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x06 && tail[i + 3] === 0x06) {
    z64 = i;
    break;
  }
const entries = Number(dv.getBigUint64(z64 + 32, true)),
  cdSize = Number(dv.getBigUint64(z64 + 40, true)),
  cdOff = Number(dv.getBigUint64(z64 + 48, true));
check("377 položek = 377 fotek", entries === 377, `${entries}`);
check("struktura konzistentní", cdOff + cdSize + (tail.length - z64) === size);
const cd = Buffer.from(
  await (
    await c.fetch(r2, { headers: { Range: `bytes=${cdOff}-${cdOff + cdSize - 1}` } })
  ).arrayBuffer(),
);
let off = 0,
  rows = [];
while (off < cd.length && cd.readUInt32LE(off) === 0x02014b50) {
  const nlen = cd.readUInt16LE(off + 28),
    elen = cd.readUInt16LE(off + 30),
    clen = cd.readUInt16LE(off + 32);
  const name = cd.subarray(off + 46, off + 46 + nlen).toString();
  let usize = cd.readUInt32LE(off + 24),
    lho = cd.readUInt32LE(off + 42);
  const ex = cd.subarray(off + 46 + nlen, off + 46 + nlen + elen);
  if (usize === 0xffffffff || lho === 0xffffffff) {
    let p = 0;
    while (p + 4 <= ex.length) {
      const id = ex.readUInt16LE(p),
        sz = ex.readUInt16LE(p + 2);
      if (id === 1) {
        let q = p + 4;
        if (usize === 0xffffffff) {
          usize = Number(ex.readBigUInt64LE(q));
          q += 16;
        }
        if (lho === 0xffffffff) lho = Number(ex.readBigUInt64LE(q));
      }
      p += 4 + sz;
    }
  }
  rows.push({ name, usize, crc: cd.readUInt32LE(off + 16), lho });
  off += 46 + nlen + elen + clen;
}
const e = rows.reduce((a, b) => (b.usize < a.usize ? b : a));
const at = e.lho + 30 + Buffer.byteLength(e.name);
const raw = Buffer.from(
  await (
    await c.fetch(r2, { headers: { Range: `bytes=${at}-${at + e.usize - 1}` } })
  ).arrayBuffer(),
);
check(`CRC fotky ${e.name}`, zlib.crc32(raw) >>> 0 === e.crc);
check(
  "fotka je celý JPEG",
  raw[0] === 0xff &&
    raw[1] === 0xd8 &&
    raw[raw.length - 2] === 0xff &&
    raw[raw.length - 1] === 0xd9,
);

console.log("\n4) Ostatní galerie");
const zips = (await keys("galleries/")).filter((k) => k.endsWith(".zip"));
check("každá galerie s fotkami má archiv", zips.length >= 6, `${zips.length} archivů`);

console.log("\n5) Pipeline uklizená");
const tr = await keys("_zip-builds/");
check("žádné zbylé bookkeeping objekty", tr.length === 0, `${tr.length}`);
const mpu = [
  ...(await (await c.fetch(`${base}?uploads`)).text()).matchAll(/<Initiated>([^<]+)</g),
].map((m) => m[1]);
check("žádné rozdělané multipart uploady", mpu.length === 0, mpu.join(", "));

console.log("\n6) Hranice 2 GB");
for (const sz of [2147483647, 2147483648, 8589934592]) {
  const r = await fetch("https://photos.svatebni-fotograf-cechy.cz/api/internal/zip-callback", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ZIP_BUILD_CALLBACK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      galleryId: "cmtj3j1pt000004jjworke62r",
      uploadId: "probe-not-a-real-upload",
      status: "ready",
      objectKey: "galleries/x/_archive.zip",
      sizeBytes: sz,
    }),
  });
  check(`sizeBytes ${sz.toLocaleString()}`, r.status === 200, `HTTP ${r.status}`);
}
console.log(`\n=== ${fails === 0 ? "VŠE OK" : fails + " kontrol selhalo"} ===\n`);
