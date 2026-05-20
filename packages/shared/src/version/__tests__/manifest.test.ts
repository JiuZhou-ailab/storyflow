import { afterEach, describe, expect, it, mock } from "bun:test";
import { getLatestVersion, getManifest } from "../manifest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("release manifest", () => {
  it("loads the latest version from the current fork GitHub release", async () => {
    const fetchMock = mock(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.github.com/repos/JiuZhou-ailab/craft-agents-oss/releases/latest");
      return Response.json({ tag_name: "v1.2.3" });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getLatestVersion()).resolves.toBe("1.2.3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads version manifests from current fork release assets", async () => {
    const manifest = {
      version: "1.2.3",
      build_time: "2026-05-20T00:00:00.000Z",
      build_timestamp: 1779235200000,
      binaries: {},
    };
    const fetchMock = mock(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://github.com/JiuZhou-ailab/craft-agents-oss/releases/download/v1.2.3/manifest.json");
      return Response.json(manifest);
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getManifest("1.2.3")).resolves.toEqual(manifest);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
