import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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
  const tagMatch = /^(version|beta|canary)-(.+)$/.exec(tagName);

  if (!tagMatch) {
    throw new Error(
      `Release tags must use version-x.x.x, beta-x.x.x-beta.n, or canary-x.x.x-canary.n. Received: ${tagName}`,
    );
  }

  const [, prefix, version] = tagMatch;
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Release tag version is not valid SemVer: ${version}`);
  }

  const channel = prefix === "version" ? "stable" : prefix;
  if (channel === "stable" && version.includes("-")) {
    throw new Error("Stable version-* tags must not use SemVer prerelease suffixes.");
  }

  if (channel === "beta" && !/-beta(?:[.-]|$)/.test(version)) {
    throw new Error("Beta tags must include a SemVer beta prerelease suffix.");
  }

  if (channel === "canary" && !/-canary(?:[.-]|$)/.test(version)) {
    throw new Error("Canary tags must include a SemVer canary prerelease suffix.");
  }

  return {
    channel,
    prerelease: channel !== "stable",
    version,
  };
}

async function writeGithubOutputs(outputs) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const { appendFile } = await import("node:fs/promises");
  const content = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await appendFile(outputPath, `${content}\n`);
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
  const release = extractVersionFromTag(tagName);

  const discoveredVersions = {
    tag: release.version,
    packageJson: packageVersion,
    tauriConfig: tauriVersion,
    cargoToml: cargoVersion,
  };

  const uniqueVersions = new Set(Object.values(discoveredVersions));
  if (uniqueVersions.size !== 1) {
    throw new Error(
      [
        "Release version mismatch detected.",
        `Tag version: ${release.version}`,
        `package.json: ${packageVersion}`,
        `src-tauri/tauri.conf.json: ${tauriVersion}`,
        `src-tauri/Cargo.toml: ${cargoVersion}`,
        "Update the repository versions first, then create the release tag.",
      ].join("\n"),
    );
  }

  await writeGithubOutputs({
    channel: release.channel,
    prerelease: release.prerelease,
    version: release.version,
  });

  console.log(
    `Release version ${release.version} matches all manifest files for the ${release.channel} channel.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
