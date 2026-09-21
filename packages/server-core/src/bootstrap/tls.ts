// input: Explicit certificate/key paths and an embedded server's listening address
// output: Fail-closed TLS settings and a verified local dial endpoint
// pos: Host TLS configuration; never changes global certificate verification
import { readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { createSecureContext } from 'node:tls'
import { isIP } from 'node:net'
import type { WsRpcTlsOptions } from '../transport/server'

function tlsError(cause?: unknown): Error {
  return Object.assign(new Error('TLS configuration or local certificate identity is invalid', { cause }), { code: 'TLS_CONFIG' })
}

export function loadServerTls(certPath?: string, keyPath?: string, caPath?: string): WsRpcTlsOptions | undefined {
  if (!certPath && !keyPath && !caPath) return undefined
  if (!certPath || !keyPath) throw tlsError()
  try {
    const tls = { cert: readFileSync(certPath), key: readFileSync(keyPath), ...(caPath ? { ca: readFileSync(caPath) } : {}) }
    createSecureContext(tls) // Includes certificate/private-key agreement.
    const cert = new X509Certificate(tls.cert)
    if (Date.now() < Date.parse(cert.validFrom) || Date.now() > Date.parse(cert.validTo)) throw tlsError()
    return tls
  } catch (cause) { throw tlsError(cause) }
}

export function localServerEndpoint(host: string, port: number, tls?: WsRpcTlsOptions): { url: string; ca?: string } {
  const address = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host
  let dialHost = address
  if (tls) {
    const cert = new X509Certificate(tls.cert)
    const matches = (name: string) => isIP(name) ? cert.checkIP(name) : cert.checkHost(name)
    if (!matches(dialHost)) {
      if (['127.0.0.1', '::1'].includes(address) && cert.checkHost('localhost')) dialHost = 'localhost'
      else throw tlsError()
    }
  }
  const urlHost = isIP(dialHost) === 6 ? `[${dialHost}]` : dialHost
  // The explicitly configured local certificate is trusted only by this local
  // connection. Node TLS still checks validity and hostname. Remote clients use
  // their own trust configuration; no process-wide verification override.
  return { url: `${tls ? 'wss' : 'ws'}://${urlHost}:${port}`, ...(tls ? { ca: tls.cert.toString() } : {}) }
}
