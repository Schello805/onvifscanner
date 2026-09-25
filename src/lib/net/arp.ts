import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Curated OUI dictionary for IP cameras, NVRs and network video devices
const OUI_VENDORS: Array<{ name: string; prefixes: string[] }> = [
  {
    name: "Hikvision",
    prefixes: [
      "bc:54:51", "00:40:8b", "44:19:b6", "c8:02:8f", "4c:bd:8f", "54:c4:15",
      "80:be:af", "a4:14:37", "c0:56:e3", "d8:96:e0", "ec:a8:6b", "ec:bd:43",
      "04:cf:4b", "28:57:be", "34:b3:54", "48:ea:63", "84:9a:40", "98:8b:5d",
      "b4:a3:82", "c4:2f:90", "e0:50:8b", "e4:30:22", "70:af:6a", "2c:d0:5a"
    ]
  },
  {
    name: "Dahua",
    prefixes: [
      "38:af:29", "4c:11:bf", "90:02:a9", "a0:bd:cd", "b4:a9:fc", "e0:50:8b",
      "3c:ef:8c", "40:2c:f4", "bc:32:5f", "d0:bf:9c", "ec:71:db", "14:a7:8b",
      "b0:c5:54", "00:1a:07", "48:2c:67"
    ]
  },
  {
    name: "Reolink",
    prefixes: [
      "ec:71:db", "48:e1:e9", "ec:ba:70", "00:03:7f", "18:81:0e", "2c:aa:8e",
      "9c:8e:cd", "1c:63:be", "60:c5:a8", "a0:92:08"
    ]
  },
  {
    name: "Axis",
    prefixes: [
      "00:40:8c", "ac:cc:8e", "b8:a4:4f", "00:1a:07"
    ]
  },
  {
    name: "TP-Link",
    prefixes: [
      "00:31:92", "14:eb:b6", "1c:3b:f3", "30:de:4b", "50:c7:bf", "54:af:97",
      "5c:e9:1e", "60:32:b1", "70:4f:57", "74:da:88", "84:d8:1b", "98:25:4a",
      "a0:f3:c1", "b0:95:75", "c0:06:c3", "cc:32:e5", "d8:07:b6", "e8:48:b8",
      "f4:f2:6d", "18:a6:f7", "34:60:f9"
    ]
  },
  {
    name: "Hanwha/Wisenet",
    prefixes: [
      "00:09:18", "00:16:6c", "00:26:73", "00:07:70", "74:ea:e8"
    ]
  },
  {
    name: "Uniview",
    prefixes: [
      "6c:f1:7e", "48:ea:63", "c8:02:8f", "28:57:be"
    ]
  },
  {
    name: "Bosch",
    prefixes: [
      "00:04:63", "00:07:5f", "00:1c:44", "00:0e:7f"
    ]
  },
  {
    name: "Mobotix",
    prefixes: [
      "00:03:c5"
    ]
  },
  {
    name: "Foscam",
    prefixes: [
      "00:62:6e", "c4:d6:55", "e0:cb:bc", "60:c5:a8"
    ]
  },
  {
    name: "Instar",
    prefixes: [
      "00:03:7f", "00:62:6e"
    ]
  },
  {
    name: "Ubiquiti",
    prefixes: [
      "00:15:6d", "00:27:22", "04:18:d6", "18:e8:29", "24:a4:3c", "68:72:51",
      "74:83:c2", "78:8a:20", "80:2a:a8", "dc:9f:db", "f0:9f:c2", "e0:63:da"
    ]
  },
  {
    name: "Raspberry Pi",
    prefixes: [
      "b8:27:eb", "dc:a6:32", "e4:5f:01", "28:cd:c1"
    ]
  },
  {
    name: "Espressif/ESP32",
    prefixes: [
      "bc:24:11", "30:ae:a4", "24:0a:c4", "a4:cf:12", "84:cc:a8", "dc:4f:22"
    ]
  }
];

export function normalizeMac(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .split(/[:-]/)
    .map((part) => part.padStart(2, "0"))
    .join(":");
}

export function lookupVendorByMac(mac?: string): string | undefined {
  if (!mac) return undefined;
  const norm = normalizeMac(mac);
  const prefix = norm.slice(0, 8); // e.g. "bc:54:51"
  for (const v of OUI_VENDORS) {
    if (v.prefixes.includes(prefix)) {
      return v.name;
    }
  }
  return undefined;
}

export async function getArpTable(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // 1. Linux: /proc/net/arp (instantaneous, zero overhead)
  try {
    const content = await fs.readFile("/proc/net/arp", "utf8");
    const lines = content.split("\n").slice(1); // skip header
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const ip = parts[0];
        const flags = parts[2];
        const mac = parts[3];
        // Flag 0x2 = complete/resolved entry
        if (ip && mac && flags !== "0x0" && mac !== "00:00:00:00:00:00") {
          map.set(ip, normalizeMac(mac));
        }
      }
    }
    if (map.size > 0) return map;
  } catch {
    // Not Linux or /proc not mounted, fallback to CLI
  }

  // 2. macOS / BSD / Linux fallback: arp -an
  try {
    const { stdout } = await execFileAsync("arp", ["-an"], { timeout: 1500 });
    for (const line of stdout.split("\n")) {
      const m = line.match(/\(([\d.]+)\)\s+at\s+([0-9a-fA-F:-]+)/);
      if (m && m[1] && m[2]) {
        const ip = m[1];
        const rawMac = m[2];
        if (!rawMac.includes("incomplete") && rawMac !== "(incomplete)") {
          map.set(ip, normalizeMac(rawMac));
        }
      }
    }
  } catch {
    // ARP command failed or timed out
  }

  return map;
}
