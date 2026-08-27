// input: A Bun script, isolated Host config directory, and JSON output marker
// output: Parsed JSON emitted by the isolated child process
// pos: Shared subprocess boundary for SessionManager and RPC lifecycle tests

export function runIsolatedJson<T = unknown>(
  configDir: string,
  marker: string,
  script: string,
): T {
  const run = Bun.spawnSync([process.execPath, '--eval', script], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = run.stdout.toString()
  if (run.exitCode !== 0) throw new Error(run.stderr.toString() || stdout)

  const prefix = `${marker}=`
  const line = stdout.split('\n').find(candidate => candidate.startsWith(prefix))
  if (!line) throw new Error(`Missing ${marker} result:\n${stdout}`)
  return JSON.parse(line.slice(prefix.length)) as T
}
