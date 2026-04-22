import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function extractCargoPackageVersion(cargoManifest) {
  const packageBlockMatch = /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(
    cargoManifest,
  );

  if (!packageBlockMatch) {
    throw new Error(
      "Could not find the package version in src-tauri/Cargo.toml.",
    );
  }

  return packageBlockMatch[1];
}

function extractVersionFromTag(tagName) {
  const tagMatch = /^version-(\d+\.\d+\.\d+)$/.exec(tagName);

  if (!tagMatch) {
    throw new Error(
      `Release tags must use the version-x.x.x format. Received: ${tagName}`,
    );
  }

  return tagMatch[1];
}

async function main() {
  const tagName = process.argv[2];
  if (!tagName) {
    throw new Error("Missing tag name argument.");
  }

  const repoRoot = process.cwd();
  const [packageJsonText, tauriConfigText, cargoManifestText] =
    await Promise.all([
      readFile(resolve(repoRoot, "package.json"), "utf8"),
      readFile(resolve(repoRoot, "src-tauri/tauri.conf.json"), "utf8"),
      readFile(resolve(repoRoot, "src-tauri/Cargo.toml"), "utf8"),
    ]);

  const packageVersion = JSON.parse(packageJsonText).version;
  const tauriVersion = JSON.parse(tauriConfigText).version;
  const cargoVersion = extractCargoPackageVersion(cargoManifestText);
  const tagVersion = extractVersionFromTag(tagName);

  const discoveredVersions = {
    tag: tagVersion,
    packageJson: packageVersion,
    tauriConfig: tauriVersion,
    cargoToml: cargoVersion,
  };

  const uniqueVersions = new Set(Object.values(discoveredVersions));
  if (uniqueVersions.size !== 1) {
    throw new Error(
      [
        "Release version mismatch detected.",
        `Tag version: ${tagVersion}`,
        `package.json: ${packageVersion}`,
        `src-tauri/tauri.conf.json: ${tauriVersion}`,
        `src-tauri/Cargo.toml: ${cargoVersion}`,
        "Update the repository versions first, then create the release tag.",
      ].join("\n"),
    );
  }

  console.log(`Release version ${tagVersion} matches all manifest files.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
