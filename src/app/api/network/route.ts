import { NextResponse } from "next/server";
import { detectLocalSubnets } from "@/lib/net/ip";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const subnets = detectLocalSubnets();
    // Prefer non-docker/virtual interfaces if possible
    const sorted = [...subnets].sort((a, b) => {
      const aVirtual = a.interfaceName.startsWith("docker") || a.interfaceName.startsWith("veth") || a.interfaceName.startsWith("br-");
      const bVirtual = b.interfaceName.startsWith("docker") || b.interfaceName.startsWith("veth") || b.interfaceName.startsWith("br-");
      if (aVirtual && !bVirtual) return 1;
      if (!aVirtual && bVirtual) return -1;
      return 0;
    });

    const primaryCidr = sorted[0]?.cidr ?? "192.168.1.0/24";
    return NextResponse.json({
      primaryCidr,
      subnets: sorted
    });
  } catch (e) {
    return NextResponse.json(
      { primaryCidr: "192.168.1.0/24", subnets: [], error: String(e) },
      { status: 200 }
    );
  }
}
