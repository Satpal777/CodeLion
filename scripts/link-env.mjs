import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const rootEnvFiles = [".env", ".env.local"];

function findRootEnv() {
  for (const envName of rootEnvFiles) {
    const fullPath = path.join(rootDir, envName);
    if (fs.existsSync(fullPath)) {
      return envName;
    }
  }
  return ".env";
}

function getWorkspaces() {
  const targets = [];
  const searchDirs = ["apps", "packages"];

  for (const dirName of searchDirs) {
    const searchPath = path.join(rootDir, dirName);
    if (!fs.existsSync(searchPath)) continue;

    const entries = fs.readdirSync(searchPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pkgJsonPath = path.join(searchPath, entry.name, "package.json");
        if (fs.existsSync(pkgJsonPath)) {
          targets.push({
            name: `${dirName}/${entry.name}`,
            fullPath: path.join(searchPath, entry.name),
          });
        }
      }
    }
  }

  return targets;
}

function linkEnvForWorkspace(target, envFileName) {
  const rootEnvPath = path.join(rootDir, envFileName);
  const targetEnvPath = path.join(target.fullPath, ".env");

  // Relative path from target directory to root env file
  const relativeTarget = path.relative(target.fullPath, rootEnvPath);

  try {
    if (fs.existsSync(targetEnvPath) || fs.lstatSync(targetEnvPath, { throwIfNoEntry: false })) {
      const stat = fs.lstatSync(targetEnvPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(targetEnvPath);
      } else {
        // Backup non-symlink file before linking
        const backupPath = `${targetEnvPath}.bak`;
        fs.renameSync(targetEnvPath, backupPath);
        console.log(`  [backup] existing .env renamed to .env.bak in ${target.name}`);
      }
    }

    try {
      fs.symlinkSync(relativeTarget, targetEnvPath, "file");
      console.log(`  [symlink] ${target.name}/.env -> ${relativeTarget}`);
    } catch (symlinkErr) {
      // Fallback for Windows without developer mode/elevation: hard link or copy
      try {
        fs.linkSync(rootEnvPath, targetEnvPath);
        console.log(`  [hardlink] ${target.name}/.env -> ${rootEnvPath}`);
      } catch {
        fs.copyFileSync(rootEnvPath, targetEnvPath);
        console.log(`  [copy] ${target.name}/.env copied from root ${envFileName}`);
      }
    }
  } catch (err) {
    console.error(`  [error] Failed to link .env for ${target.name}:`, err.message);
  }
}

function main() {
  const envFileName = findRootEnv();
  const rootEnvPath = path.join(rootDir, envFileName);

  console.log(`Source root env: ${envFileName}`);

  if (!fs.existsSync(rootEnvPath)) {
    // If no .env exists at root yet, create an empty .env file template
    fs.writeFileSync(rootEnvPath, "", { flag: "wx" });
    console.log(`  Created empty root ${envFileName}`);
  }

  const workspaces = getWorkspaces();
  console.log(`Found ${workspaces.length} workspace packages/apps:\n`);

  for (const workspace of workspaces) {
    linkEnvForWorkspace(workspace, envFileName);
  }

  console.log("\nDone linking environment files across all workspaces.");
}

main();
