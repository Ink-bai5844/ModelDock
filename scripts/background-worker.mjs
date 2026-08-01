import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const node = process.execPath;
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(350);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

const [serverRunning, webRunning] = await Promise.all([
  isListening(3000),
  isListening(4173),
]);

if (!serverRunning) {
  const build = spawnSync(node, [tsc, "-p", "tsconfig.server.json"], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const services = [
  {
    running: serverRunning,
    args: [path.join(root, "dist-server", "index.js")],
  },
  {
    running: webRunning,
    args: [vite, "--host", "127.0.0.1", "--port", "4173"],
  },
];

for (const { running, args } of services) {
  if (running) continue;
  const child = spawn(node, args, {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
}
