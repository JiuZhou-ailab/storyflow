#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import readline from 'node:readline'

const stateFile = process.env.MCP_SPAWN_STATE_FILE

if (!stateFile) {
  process.stderr.write('MCP_SPAWN_STATE_FILE is required\n')
  process.exit(1)
}

const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { count: 0 }

state.count += 1
writeFileSync(stateFile, JSON.stringify(state))

if (state.count > 1) {
  process.stderr.write('duplicate MCP server spawn\n')
  process.exit(42)
}

const rl = readline.createInterface({ input: process.stdin })
const send = (msg) => {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

rl.on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }

  if (req.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-server-spawn-once', version: '1.0.0' },
      },
    })
    return
  }

  if (req.method === 'notifications/initialized') return

  if (req.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: [
          {
            name: 'once',
            description: 'Reports a single transport-owned spawn',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    })
  }
})
