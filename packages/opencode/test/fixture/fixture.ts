import { $ } from "bun"
import os from "os"
import path from "path"
import fs from "fs"

type TmpDirOptions<T> = {
  git?: boolean
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
  await $`mkdir -p ${dirpath}`.quiet()
  const realdirpath = fs.realpathSync(dirpath)

  if (options?.git) await $`git init`.cwd(realdirpath).quiet()
  const extra = await options?.init?.(realdirpath)
  const result = {
    [Symbol.asyncDispose]: async () => {
      await options?.dispose?.(realdirpath)
      await $`rm -rf ${realdirpath}`.quiet()
    },
    path: realdirpath,
    extra: extra as T,
  }
  return result
}
