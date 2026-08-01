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

function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function startDetached(args) {
  if (process.platform === "win32") {
    const argumentList = args.map(powershellLiteral).join(", ");
    const command = [
      `$process = Start-Process -FilePath ${powershellLiteral(node)}`,
      `-ArgumentList @(${argumentList})`,
      `-WorkingDirectory ${powershellLiteral(root)}`,
      "-WindowStyle Hidden -PassThru",
    ].join(" ");
    const commandWithOutput = `${command}; $process.Id`;
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        commandWithOutput,
      ],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || "无法启动后台服务。");
    }
    return Number.parseInt(result.stdout.trim(), 10);
  }

  const child = spawn(node, args, {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

const [serverRunning, webRunning] = await Promise.all([
  isListening(3000),
  isListening(4173),
]);

if (serverRunning && webRunning) {
  console.log("ModelDock 已在后台运行：http://127.0.0.1:4173");
} else {
  const started = [];
  if (!serverRunning) {
    const build = spawnSync(node, [tsc, "-p", "tsconfig.server.json"], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    if (build.status !== 0) process.exit(build.status ?? 1);
    started.push(`后端 PID ${startDetached([path.join(root, "dist-server", "index.js")])}`);
  }
  if (!webRunning) {
    started.push(
      `前端 PID ${startDetached([vite, "--host", "127.0.0.1", "--port", "4173"])}`,
    );
  }
  console.log(`ModelDock 已提交后台启动：${started.join("，")}`);
}
