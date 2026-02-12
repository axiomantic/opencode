import { $ } from "bun"

export const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string; assetExt: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    ocBinary: "opencode-darwin-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    ocBinary: "opencode-darwin-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    ocBinary: "opencode-windows-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    ocBinary: "opencode-linux-x64",
    assetExt: "tar.gz",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    ocBinary: "opencode-linux-arm64",
    assetExt: "tar.gz",
  },
]

function detectHostTarget(): string {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
  const platform = process.platform
  if (platform === "darwin") return `${arch}-apple-darwin`
  if (platform === "win32") return `${arch}-pc-windows-msvc`
  return `${arch}-unknown-linux-gnu`
}

export const RUST_TARGET = Bun.env.RUST_TARGET ?? Bun.env.TAURI_ENV_TARGET_TRIPLE ?? detectHostTarget()

export function getCurrentSidecar(target = RUST_TARGET) {
  if (!target) throw new Error("RUST_TARGET not set")

  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === target)
  if (!binaryConfig) throw new Error(`Sidecar configuration not available for Rust target '${RUST_TARGET}'`)

  return binaryConfig
}

export async function copyBinaryToSidecarFolder(source: string, target = RUST_TARGET) {
  await $`mkdir -p src-tauri/sidecars`
  const dest = windowsify(`src-tauri/sidecars/opencode-cli-${target}`)
  await $`cp ${source} ${dest}`

  console.log(`Copied ${source} to ${dest}`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
