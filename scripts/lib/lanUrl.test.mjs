import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import {
  keyFromEnvFile,
  lanAddresses,
  phoneUrl,
  redactKey,
  terminalQr,
  withKeyInEnvFile,
} from "./lanUrl.mjs";

const ipv4 = (address, internal = false) => ({ family: "IPv4", address, internal });

describe("lanAddresses", () => {
  it("puts Wi-Fi's private address ahead of VM bridges, tunnels and public addresses", () => {
    const found = lanAddresses({
      lo0: [ipv4("127.0.0.1", true), { family: "IPv6", address: "::1", internal: true }],
      bridge100: [ipv4("192.168.64.1")],
      utun4: [ipv4("100.101.102.103")],
      en0: [{ family: "IPv6", address: "fe80::1", internal: false }, ipv4("169.254.3.4"), ipv4("192.168.1.23")],
      en5: [{ family: 4, address: "10.0.0.7", internal: false }],
    });
    expect(found).toEqual([
      { name: "en0", address: "192.168.1.23" },
      { name: "en5", address: "10.0.0.7" },
      { name: "bridge100", address: "192.168.64.1" },
      { name: "utun4", address: "100.101.102.103" },
    ]);
  });

  it("counts only 172.16/12 as private", () => {
    const found = lanAddresses({ en0: [ipv4("172.32.0.1")], en1: [ipv4("172.31.0.1")] });
    expect(found.map(entry => entry.address)).toEqual(["172.31.0.1", "172.32.0.1"]);
  });

  it("finds nothing on a machine with only loopback", () => {
    expect(lanAddresses({ lo0: [ipv4("127.0.0.1", true)] })).toEqual([]);
  });
});

describe("phoneUrl", () => {
  it("puts the key and extra parameters in the query, encoded", () => {
    const href = phoneUrl({
      address: "192.168.1.23", port: 4173, path: "tour/twin-cities/", key: "AIza+/=",
      query: ["set.renderer.experiments.all=1", "renderer=webgl2"],
    });
    const url = new URL(href);
    expect(url.origin).toBe("http://192.168.1.23:4173");
    expect(url.pathname).toBe("/tour/twin-cities/");
    expect(url.searchParams.get("key")).toBe("AIza+/=");
    expect(url.searchParams.get("set.renderer.experiments.all")).toBe("1");
    expect(url.searchParams.get("renderer")).toBe("webgl2");
  });

  it("opens the root with no query when given only an address and port", () => {
    expect(phoneUrl({ address: "10.0.0.7", port: 5173 })).toBe("http://10.0.0.7:5173/");
  });

  it("keeps an = inside a parameter's value", () => {
    expect(new URL(phoneUrl({ address: "10.0.0.7", port: 5173, query: ["a=b=c"] })).searchParams.get("a")).toBe("b=c");
  });
});

describe("redactKey", () => {
  it("hides the key's value and keeps the rest", () => {
    const href = phoneUrl({ address: "10.0.0.7", port: 5173, key: "AIzaSECRET", query: ["x=1"] });
    const shown = redactKey(href);
    expect(shown).not.toContain("AIzaSECRET");
    expect(shown).toBe("http://10.0.0.7:5173/?key=<Google key>&x=1");
  });

  it("leaves a URL without a key alone", () => {
    expect(redactKey("http://10.0.0.7:5173/?x=1")).toBe("http://10.0.0.7:5173/?x=1");
  });
});

describe(".env.local", () => {
  it("reads the key, trimmed, among other lines", () => {
    expect(keyFromEnvFile("OTHER=1\nFOSS_EARTH_GOOGLE_KEY= AIza123 \n")).toBe("AIza123");
    expect(keyFromEnvFile("OTHER=1\n")).toBe("");
  });

  it("adds the key to a new or existing file and replaces an old one, keeping other lines", () => {
    expect(withKeyInEnvFile("", "k1")).toBe("FOSS_EARTH_GOOGLE_KEY=k1\n");
    expect(withKeyInEnvFile("OTHER=1\n", "k1")).toBe("OTHER=1\nFOSS_EARTH_GOOGLE_KEY=k1\n");
    expect(withKeyInEnvFile("OTHER=1", "k1")).toBe("OTHER=1\nFOSS_EARTH_GOOGLE_KEY=k1\n");
    const replaced = withKeyInEnvFile("A=1\nFOSS_EARTH_GOOGLE_KEY=old\nB=2\n", "new");
    expect(replaced).toBe("A=1\nFOSS_EARTH_GOOGLE_KEY=new\nB=2\n");
    expect(keyFromEnvFile(replaced)).toBe("new");
  });
});

describe("terminalQr", () => {
  it("draws every module of the code, two rows to a line, inside a 4-module quiet zone", () => {
    const { modules } = QRCode.create("http://192.168.1.23:4173/tour/twin-cities/?key=AIzaSyExample", { errorCorrectionLevel: "L" });
    // Read the half blocks back into rows of modules.
    const lines = terminalQr(modules).split("\n").map(line => line.replace(/\x1b\[[\d;]*m/g, ""));
    const rows = [];
    for (const line of lines) {
      rows.push([...line].map(glyph => glyph === "█" || glyph === "▀"));
      rows.push([...line].map(glyph => glyph === "█" || glyph === "▄"));
    }
    const side = modules.size + 8;
    expect(lines.every(line => [...line].length === side)).toBe(true);
    expect(rows.length).toBe(side + 1);
    for (let row = 0; row < side; row++) {
      for (let column = 0; column < side; column++) {
        const inside = row >= 4 && column >= 4 && row < modules.size + 4 && column < modules.size + 4;
        expect(rows[row][column]).toBe(inside && Boolean(modules.get(row - 4, column - 4)));
      }
    }
    expect(rows[side].every(dark => !dark)).toBe(true);
  });
});
