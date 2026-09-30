import { parseEnv } from "node:util";

/** The environment variable, and the `.env.local` line, that holds the Google Maps key. */
export const GOOGLE_KEY_VARIABLE = "FOSS_EARTH_GOOGLE_KEY";

/** The QR specification's quiet zone: 4 light modules on every side. */
const QUIET_ZONE = 4;
/** Black on bright white, so the code reads the same in a dark or a light terminal. */
const INK = "\x1b[30;107m";
const RESET = "\x1b[0m";

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
/** Wi-Fi and Ethernet, as macOS and Linux name them; bridges, VPN tunnels and VMs rank after. */
const PHYSICAL = /^(en|eth|wlan|wl)/;

/**
 * This machine's IPv4 addresses a phone on the same network could reach, best first:
 * a private address on Wi-Fi or Ethernet, then other private ones (VM bridges, VPNs),
 * then the rest. Loopback and link-local addresses are left out.
 * `interfaces` is the shape `os.networkInterfaces()` returns.
 */
export function lanAddresses(interfaces) {
  const found = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      // Node 18.0–18.3 gave the family as a number.
      if ((entry.family !== "IPv4" && entry.family !== 4) || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      found.push({ name, address: entry.address });
    }
  }
  const rank = ({ name, address }) => {
    const isPrivate = PRIVATE.some(range => range.test(address));
    return isPrivate && PHYSICAL.test(name) ? 0 : isPrivate ? 1 : 2;
  };
  return found.sort((a, b) => rank(a) - rank(b));
}

/**
 * The address a phone opens: `http://<address>:<port><path>`, with the Google key as `key`,
 * which the app saves on the device and takes off the address bar, and any extra
 * `name=value` query parameters, such as `set.renderer.experiments.all=1`.
 */
export function phoneUrl({ address, port, path = "/", key = "", query = [] }) {
  const url = new URL(`http://${address}:${port}`);
  url.pathname = path.startsWith("/") ? path : `/${path}`;
  if (key) url.searchParams.set("key", key);
  for (const parameter of query) {
    const split = parameter.indexOf("=");
    if (split < 0) url.searchParams.append(parameter, "");
    else url.searchParams.append(parameter.slice(0, split), parameter.slice(split + 1));
  }
  return url.href;
}

/** The URL with the key's value hidden, to print where a log or a screenshot might keep it. */
export function redactKey(href) {
  const url = new URL(href);
  if (!url.searchParams.has("key")) return href;
  url.searchParams.set("key", "KEY");
  return url.href.replace("key=KEY", "key=<Google key>");
}

/** The Google key in a `.env` file's text, or "" when it has none. */
export function keyFromEnvFile(text) {
  return parseEnv(text)[GOOGLE_KEY_VARIABLE]?.trim() ?? "";
}

/** The `.env` file's text with the Google key line set to `key`, other lines kept. */
export function withKeyInEnvFile(text, key) {
  const line = `${GOOGLE_KEY_VARIABLE}=${key}`;
  const lines = text.split("\n");
  const at = lines.findIndex(existing => existing.startsWith(`${GOOGLE_KEY_VARIABLE}=`));
  if (at >= 0) lines[at] = line;
  else if (text === "" || text.endsWith("\n")) lines.splice(lines.length - 1, 0, line);
  else lines.push(line);
  const joined = lines.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

/**
 * Draws a QR code's modules in a terminal, two rows to a line with half blocks, dark
 * modules in black on white, inside the quiet zone. `modules` is the `BitMatrix` that
 * `QRCode.create(text).modules` returns: `size` and `get(row, column)`.
 */
export function terminalQr(modules) {
  const { size } = modules;
  const dark = (row, column) => row >= 0 && column >= 0 && row < size && column < size
    && Boolean(modules.get(row, column));
  const lines = [];
  for (let row = -QUIET_ZONE; row < size + QUIET_ZONE; row += 2) {
    let line = "";
    for (let column = -QUIET_ZONE; column < size + QUIET_ZONE; column++) {
      const top = dark(row, column);
      const bottom = dark(row + 1, column);
      line += top ? (bottom ? "█" : "▀") : (bottom ? "▄" : " ");
    }
    lines.push(`${INK}${line}${RESET}`);
  }
  return lines.join("\n");
}
