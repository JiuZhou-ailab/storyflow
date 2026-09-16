// input: Cloudflare HTTP requests and private service-binding authorization calls
// output: Public identity routes and private current-access decisions
// pos: Platform entrypoint; authorization RPC is never exposed over HTTP
import { WorkerEntrypoint } from 'cloudflare:workers'
import broker, { type Env } from './index'
import { authorizeAccess } from './access-state'
import type { AccessIdentity } from '../../../packages/shared/src/auth/managed-access'

export class AccessAuthority extends WorkerEntrypoint<Env> {
  authorize(identity: AccessIdentity, scope?: string, model?: string) {
    return authorizeAccess(this.env, identity, scope, model)
  }
}
export default broker
