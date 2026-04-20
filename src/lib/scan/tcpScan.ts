import net from "node:net";

export async function scanTcpPorts(
  ip: string,
  ports: number[],
  timeoutMs: number
): Promise<number[]> {
  const checks = ports.map((port) => checkPort(ip, port, timeoutMs));
  const results = await Promise.all(checks);
  return results.filter((r): r is number => typeof r === "number");
}

function checkPort(ip: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (result: number | null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(port));
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
    socket.connect(port, ip);
  });
}

