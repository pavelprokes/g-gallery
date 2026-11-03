// A slow link for any browser: an HTTP/HTTPS proxy that adds round trips and
// caps bandwidth, one emulated link shared by every connection through it
// (docs/DEVICE-TESTING.md). DevTools throttling exists only in Chromium and
// delays whole requests; this delays the bytes, so WebKit (Safari, every iPhone
// browser) and Firefox get the same slow link Chromium does — and so does a real
// phone pointed at it.
//
//   node scripts/devices/throttle-proxy.mjs [--net=slow4g] [--port=8899] [--lan]
//
// --lan listens on every interface, for a real phone on the same Wi-Fi
// (iPhone: Settings → Wi-Fi → ⓘ → Configure Proxy → Manual → this Mac's
// address and the port). While it runs, anyone on that network can use it as
// a proxy: stop it when done.
import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { pathToFileURL } from "node:url";

/**
 * Packet-level presets. Slow 4G is Lighthouse's default mobile link (150 ms
 * RTT, 1.6 Mbps down, 750 kbps up — lighthouse/docs/throttling.md, "identical
 * to WebPageTest's Mobile 3G - Fast"); DevTools' own "Slow 4G" (562.5 ms per
 * request, 1.44 Mbps) is the same link inflated to make up for throttling
 * whole requests. 3G and 4G are WebPageTest's "3G Slow" and "4G".
 */
export const NETWORKS = {
  none: null,
  "4g": { rttMs: 170, downKbps: 9000, upKbps: 9000 },
  slow4g: { rttMs: 150, downKbps: 1.6 * 1024, upKbps: 750 },
  "3g": { rttMs: 400, downKbps: 400, upKbps: 400 },
};

/** How much one connection may have in flight before its sender is paused —
 * roughly a congestion window, so a cancelled download stops arriving soon
 * after instead of draining a whole file out of this proxy's memory. */
const WINDOW = 64 * 1024;
/** Released in slices, so a large chunk arrives progressively as it would. */
const SLICE = 16 * 1024;
/** With `lan`, what a phone needs and nothing else on this machine. */
const LAN_PORTS = new Set([80, 443, 3000]);
/** Never reached from the network: this machine's own loopback and the like —
 * checked on the resolved address, which no spelling of a name can dodge
 * (`127.1`, `::ffff:127.0.0.1`, a DNS name pointing at 127.0.0.1). */
const LOCAL = new net.BlockList();
LOCAL.addSubnet("127.0.0.0", 8);
LOCAL.addSubnet("0.0.0.0", 8);
LOCAL.addSubnet("169.254.0.0", 16);
LOCAL.addAddress("::1", "ipv6");
LOCAL.addAddress("::", "ipv6");
LOCAL.addSubnet("fe80::", 10, "ipv6");

/**
 * @param {{ rttMs: number, downKbps: number, upKbps: number } | null} network
 *   null relays at full speed (still useful for `block`).
 * @param {{ port?: number, lan?: boolean, block?: RegExp }} [options]
 *   `block` refuses hosts outright (analytics, realtime), with no route
 *   interception in the browser — which would turn its HTTP cache off.
 *   `lan` listens on every interface and forwards only to ports 80, 443 and
 *   3000 off this machine: never to its loopback services (Postgres, MinIO…).
 */
export function startThrottleProxy(network, { port = 0, lan = false, block } = {}) {
  const oneWayMs = network ? network.rttMs / 2 : 0;
  const lane = (kbps) => ({ bytesPerMs: network ? kbps / 8 : Infinity, freeAt: 0 });
  const down = lane(network?.downKbps);
  const up = lane(network?.upKbps);
  const sockets = new Set();
  /** Where to connect for `hostname`, or null when refused. With `lan`, the
   * name is resolved once, every address checked, and the checked one is
   * what gets connected to — a second lookup cannot answer differently. */
  async function destination(hostname, targetPort) {
    if (!Number.isInteger(targetPort) || block?.test(hostname)) return null;
    if (!lan) return hostname;
    if (!LAN_PORTS.has(targetPort)) return null;
    const addresses = await dns.lookup(hostname, { all: true }).catch(() => []);
    const local = ({ address, family }) => LOCAL.check(address, family === 6 ? "ipv6" : "ipv4");
    return addresses.length > 0 && !addresses.some(local) ? addresses[0].address : null;
  }

  // Bytes leave in arrival order at the link's rate, plus half a round trip.
  // `lane.freeAt` is shared by every connection: one link, not one per socket.
  function relay(from, to, link) {
    const queue = [];
    let queued = 0;
    let lastAt = 0;
    let timer = null;
    const pump = () => {
      timer = null;
      const now = performance.now();
      while (queue.length > 0 && queue[0].at <= now) {
        const { chunk } = queue.shift();
        if (to.destroyed) {
          // Nobody to deliver to (the browser dropped it): stop the source too.
          queue.length = 0;
          from.destroy();
          return;
        }
        if (chunk) {
          to.write(chunk);
          queued -= chunk.length;
        } else to.end();
      }
      if (queued <= WINDOW / 2 && from.isPaused()) from.resume();
      if (queue.length > 0) timer = setTimeout(pump, queue[0].at - now);
    };
    const push = (chunk, at) => {
      lastAt = at;
      queue.push({ chunk, at });
      timer ??= setTimeout(pump, at - performance.now());
    };
    from.on("data", (data) => {
      for (let offset = 0; offset < data.length; offset += SLICE) {
        const chunk = data.subarray(offset, offset + SLICE);
        const now = performance.now();
        link.freeAt = Math.max(now, link.freeAt) + chunk.length / link.bytesPerMs;
        queued += chunk.length;
        push(chunk, link.freeAt + oneWayMs);
      }
      if (queued > WINDOW) from.pause();
    });
    from.on("end", () => push(null, Math.max(lastAt, performance.now() + oneWayMs)));
    from.on("error", () => to.destroy());
    to.on("error", () => from.destroy());
  }

  const server = http.createServer(async (req, res) => {
    // A plain http:// request, sent to a proxy with its absolute address.
    const target = URL.canParse(req.url) ? new URL(req.url) : null;
    const targetPort = Number(target?.port) || 80;
    const address = target
      ? await destination(target.hostname.replace(/^\[|\]$/g, ""), targetPort)
      : null;
    if (!target || !address) {
      res.writeHead(target ? 403 : 400).end();
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    const options = {
      host: address,
      port: targetPort,
      path: target.pathname + target.search,
      method: req.method,
      headers, // the browser's own Host header names the site
    };
    const upstream = http.request(options, (response) => {
      // Node sends the head with the first chunk (or the end), which `relay`
      // delays by the way back; the way there was charged on the request.
      res.writeHead(response.statusCode ?? 502, response.headers);
      relay(response, res, down);
    });
    upstream.on("error", () => res.destroy());
    relay(req, upstream, up);
  });

  server.on("connect", async (req, client, head) => {
    client.on("error", () => client.destroy());
    // "host:port" by hand: a URL would drop port 80 as the default and leave "".
    const colon = req.url.lastIndexOf(":");
    const targetPort = Number(req.url.slice(colon + 1));
    const address =
      colon > 0
        ? await destination(req.url.slice(0, colon).replace(/^\[|\]$/g, ""), targetPort)
        : null;
    if (!address || client.destroyed) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = net.connect(targetPort, address);
    sockets.add(client).add(upstream);
    client.on("close", () => sockets.delete(client));
    upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.once("connect", () => {
      // The TCP handshake's round trip, which the tunnel would otherwise skip.
      setTimeout(() => {
        if (client.destroyed) return;
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        relay(client, upstream, up);
        relay(upstream, client, down);
      }, network?.rttMs ?? 0);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", () =>
      resolve({
        port: server.address().port,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
            server.closeAllConnections();
          }),
      }),
    );
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value ?? "1"];
    }),
  );
  const name = args.net ?? "slow4g";
  if (!(name in NETWORKS)) {
    console.error(`--net must be one of: ${Object.keys(NETWORKS).join(", ")}`);
    process.exit(1);
  }
  const proxy = await startThrottleProxy(NETWORKS[name], {
    port: Number(args.port ?? 8899),
    lan: Boolean(args.lan),
  });
  const addresses = args.lan
    ? Object.values(os.networkInterfaces())
        .flat()
        .filter((address) => address?.family === "IPv4" && !address.internal)
        .map((address) => address.address)
    : ["127.0.0.1"];
  console.log(`${name} proxy on ${addresses.map((a) => `${a}:${proxy.port}`).join(", ")}`);
  console.log(JSON.stringify(NETWORKS[name]));
  if (args.lan) {
    console.log(
      "Open to this whole network (ports 80, 443, 3000) while it runs — Ctrl+C when done.",
    );
  }
}
