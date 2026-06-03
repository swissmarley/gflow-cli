import { homedir } from "node:os";
import { resolve } from "node:path";

export function resolveProfileDir(profile: string): string {
  return resolve(process.cwd(), ".gflow", "profiles", profile);
}

export function resolveOutputDir(outDir: string): string {
  return resolve(process.cwd(), outDir);
}

export function defaultCacheDir(): string {
  return resolve(homedir(), ".cache", "gflow");
}
