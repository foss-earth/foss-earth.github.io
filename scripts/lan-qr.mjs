#!/usr/bin/env node
/**
 * Prints a QR code in the terminal that opens a local dev or preview server on a phone on
 * the same network: this machine's LAN address, the server's port, a path, and the Google
 * Maps key, which the app saves on the phone and takes off its address bar. The code is
 * drawn here; nothing is sent anywhere.
 *
 *   npm run dev -- --host          # or: npm run preview -- --host
 *   npm run qr                     # in FOSS Earth
 *   npx foss-earth-qr --path=/tour/twin-cities/   # in an application that links FOSS Earth
 *
 * Options:
 *   --port=n          the server's port. Default: the first of 5173 (dev) and 4173 (preview)
 *                     that answers on the LAN address.
 *   --path=/p/        the page to open. Default: /
 *   --query=a=b       an extra query parameter, such as --query=set.renderer.experiments.all=1.
 *                     Repeat it for more.
 *   --host=address    the address to put in the code, when the one chosen is not the
 *                     phone's network. The others found are listed.
 *   --no-key          leave the Google key out.
 *
 * The key comes from the FOSS_EARTH_GOOGLE_KEY environment variable, or else that line in
 * this checkout's .env.local, which git ignores and Vite refuses to serve. With neither, it
 * asks for the key once and saves it there.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import {
  GOOGLE_KEY_VARIABLE,
  keyFromEnvFile,
  lanAddresses,
  phoneUrl,
  redactKey,
  terminalQr,
  withKeyInEnvFile,
} from "./lib/lanUrl.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
const SERVER_PORTS = [5173, 4173];
/** How long to wait for the server to accept a connection before calling the port closed. */
const PROBE_MS = 400;

function parseArgs(argv) {
  const options = { query: [], key: true };
  for (const arg of argv) {
    const [name, ...rest] = arg.split("=");
    const value = rest.join("=");
    if (name === "--port") options.port = Number(value);
    else if (name === "--path") options.path = value;
    else if (name === "--query") options.query.push(value);
    else if (name === "--host") options.host = value;
    else if (name === "--no-key") options.key = false;
    else if (name === "--help" || name === "-h") options.help = true;
    else throw new Error(`Unknown option ${arg}. Run with --help for the options.`);
  }
  if (options.port !== undefined && !(Number.isInteger(options.port) && options.port > 0 && options.port < 65536)) {
    throw new Error("--port takes a port number, such as --port=4173.");
  }
  return options;
}

function listens(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = answer => { socket.destroy(); resolve(answer); };
    socket.setTimeout(PROBE_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function googleKey() {
  const fromEnvironment = process.env[GOOGLE_KEY_VARIABLE]?.trim();
  if (fromEnvironment) return { key: fromEnvironment, from: `${GOOGLE_KEY_VARIABLE} in the environment` };
  const saved = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const fromFile = keyFromEnvFile(saved);
  if (fromFile) return { key: fromFile, from: `${GOOGLE_KEY_VARIABLE} in ${envFile}` };
  if (!process.stdin.isTTY) {
    throw new Error(`No Google key. Put ${GOOGLE_KEY_VARIABLE}=<key> in ${envFile}, or pass --no-key.`);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const key = (await prompt.question("Google Maps key, saved in .env.local for next time (Enter for none): ")).trim();
  prompt.close();
  if (!key) return { key: "", from: "none given" };
  writeFileSync(envFile, withKeyInEnvFile(saved, key));
  chmodSync(envFile, 0o600);
  return { key, from: `saved as ${GOOGLE_KEY_VARIABLE} in ${envFile}` };
}

function usage() {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  return source.slice(source.indexOf("/**") + 3, source.indexOf("*/")).replace(/^ \* ?/gm, "").trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }

  const addresses = lanAddresses(os.networkInterfaces());
  const address = options.host ?? addresses[0]?.address;
  if (!address) throw new Error("This machine has no network address a phone could reach. Join the phone's Wi-Fi first.");

  const notes = [];
  let port = options.port;
  if (port === undefined) {
    const open = [];
    for (const candidate of SERVER_PORTS) if (await listens(address, candidate)) open.push(candidate);
    port = open[0] ?? SERVER_PORTS[0];
    if (open.length > 1) notes.push(`Ports ${open.join(" and ")} both answer; using ${port}. Pass --port for another.`);
    if (!open.length) notes.push(nothingAnswers(address, port));
  } else if (!(await listens(address, port))) {
    notes.push(nothingAnswers(address, port));
  }

  const { key, from } = options.key ? await googleKey() : { key: "", from: "left out (--no-key)" };
  const url = phoneUrl({ address, port, path: options.path, key, query: options.query });
  const qr = QRCode.create(url, { errorCorrectionLevel: "L" });

  console.log(`\n${terminalQr(qr.modules)}\n`);
  console.log(redactKey(url));
  console.log(`Google key: ${from}.`);
  const others = addresses.filter(entry => entry.address !== address);
  if (others.length) {
    console.log(`Other addresses: ${others.map(entry => `${entry.address} (${entry.name})`).join(", ")}. Choose one with --host=.`);
  }
  for (const note of notes) console.log(note);
  console.log("Over plain http a phone's browser offers no WebGPU, so the app draws with WebGL there.");
}

function nothingAnswers(address, port) {
  return `Nothing answers at ${address}:${port} yet. Start the server with --host so the phone can reach it:`
    + " npm run dev -- --host, or npm run preview -- --host.";
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
