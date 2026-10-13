import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const quote = String.fromCharCode(34)
const EXPO_REFERENCE = `/// <reference types=${quote}expo/types${quote} />\\n`

/**
 * One line, with no shell-specific syntax, so the same check runs under bash and under Windows cmd.
 * Creates the Expo type stub the app expects, then type-checks.
 */
export const FACTORY_SHIPPED_VERIFY = [
  'node -e "',
  "const fs=require('fs');const cp=require('child_process');",
  "const file='expo-env.d.ts';",
  `if(!fs.existsSync(file))fs.writeFileSync(file,'${EXPO_REFERENCE}');`,
  "const run=cp.spawnSync('npx',['tsc','--noEmit'],{shell:true,encoding:'utf8'});",
  'if(run.stdout)process.stdout.write(run.stdout);',
  'if(run.stderr)process.stderr.write(run.stderr);',
  'process.exit(run.status==null?1:run.status)"'
].join('')

export const FACTORY_SHIPPED_SETUP = 'npm install'

export function packageDeclaresExpo(content: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return false
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false
  }
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const value = Object.getOwnPropertyDescriptor(parsed, key)?.value
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.hasOwn(value, 'expo')
    ) {
      return true
    }
  }
  return false
}

/** The check this app ships for an Expo project that has no orca.yaml of its own. */
export function readShippedFactoryScripts(
  repoPath: string
): { setup: string; verify: string } | null {
  let content: string
  try {
    content = readFileSync(join(repoPath, 'package.json'), 'utf8')
  } catch {
    return null
  }
  return packageDeclaresExpo(content)
    ? { setup: FACTORY_SHIPPED_SETUP, verify: FACTORY_SHIPPED_VERIFY }
    : null
}
