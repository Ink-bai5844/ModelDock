import path from "node:path";
import process from "node:process";
import {
  loadConfig,
  readRequiredEnvironmentVariable,
} from "../dist-server/config.js";
import { loadFileAccountSnapshot } from "../dist-server/storage/file-account-snapshot.js";
import { MySqlAccountStorage } from "../dist-server/storage/mysql-account-storage.js";

const projectRoot = process.cwd();
const apply = process.argv.includes("--apply");
const config = await loadConfig(projectRoot);
const snapshot = await loadFileAccountSnapshot(
  path.resolve(projectRoot, config.dataDirectory),
);
const storage = new MySqlAccountStorage({
  host: config.mysql.host,
  port: config.mysql.port,
  database: config.mysql.database,
  user: config.mysql.user,
  password: readRequiredEnvironmentVariable(
    config.mysql.passwordEnvironmentVariable,
  ),
});

try {
  await storage.initialize();
  const result = await storage.importAccounts(
    snapshot.records,
    snapshot.sourceManifest,
    !apply,
  );
  console.log(JSON.stringify({
    ok: true,
    ...result,
    sourceBytes: snapshot.sourceBytes,
  }));
} finally {
  await storage.close();
}
