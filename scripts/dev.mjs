import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const node = process.execPath;
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

await run(node, [tsc, "-p", "tsconfig.server.json"]);

const children = [
  spawn(node, [path.join(root, "dist-server", "index.js")], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(node, [vite, "--host", "127.0.0.1", "--port", "4173"], {
    cwd: root,
    stdio: "inherit",
  }),
];

function stop() {
  for (const child of children) child.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await Promise.race(
  children.map(
    (child) =>
      new Promise((resolve) => child.once("exit", resolve)),
  ),
);
stop();
