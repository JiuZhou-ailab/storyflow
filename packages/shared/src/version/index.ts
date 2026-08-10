// input: Shared package metadata
// output: Canonical application version
// pos: Runtime version boundary shared by update UI and build surfaces

import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;

export function getAppVersion(): string {
  return APP_VERSION;
}
