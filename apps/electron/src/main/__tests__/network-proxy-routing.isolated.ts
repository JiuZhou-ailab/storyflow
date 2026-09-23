import { afterAll, expect, it, mock, spyOn } from 'bun:test';
import * as undici from 'undici/index.js';
import net from 'node:net';
import { createServer } from 'node:http';
import type { NetworkProxySettings } from '@craft-agent/shared/config/types';

let settings: NetworkProxySettings | undefined;
// Exercise the installed Node implementation rather than Bun's undici shim.
mock.module('undici', () => undici);
const { getGlobalDispatcher, setGlobalDispatcher } = undici;
mock.module('electron', () => ({ app: { isReady: () => false }, session: {} }));
mock.module('../logger', () => ({ default: { info: () => {} } }));
mock.module('../browser-pane-manager', () => ({ BROWSER_PANE_SESSION_PARTITION: 'test' }));
mock.module('@craft-agent/shared/config/storage', () => ({
  getNetworkProxySettings: () => settings,
  setNetworkProxySettings: () => {},
}));

const originalDispatcher = getGlobalDispatcher();
const { applyConfiguredProxySettings } = await import('../network-proxy');
afterAll(async () => {
  await getGlobalDispatcher().close();
  setGlobalDispatcher(originalDispatcher);
  mock.restore();
});

it('gives direct, NO_PROXY, and unproxied protocols enough time to connect', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Connection', 'close');
    response.end('ok');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  const connect = spyOn(net, 'connect');
  try {
    for (const config of [
      undefined,
      { enabled: true, httpProxy: 'http://127.0.0.1:1', noProxy: '127.0.0.1' },
      { enabled: true, httpsProxy: 'http://127.0.0.1:1' },
    ]) {
      settings = config;
      await applyConfiguredProxySettings();
      connect.mockClear();
      const response = await getGlobalDispatcher().request({ origin: `http://127.0.0.1:${port}`, path: '/', method: 'GET' });
      expect(await response.body.text()).toBe('ok');
      expect(connect).toHaveBeenCalled();
      const options = connect.mock.calls[0]![0] as unknown as net.NetConnectOpts & { autoSelectFamilyAttemptTimeout?: number };
      expect(options.autoSelectFamilyAttemptTimeout).toBeGreaterThanOrEqual(1_000);
    }
  } finally {
    connect.mockRestore();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
