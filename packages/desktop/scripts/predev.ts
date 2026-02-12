import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, RUST_TARGET, windowsify } from "./utils"

const sidecarConfig = getCurrentSidecar()

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

await $`cd ../opencode && bun run build --single`

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
