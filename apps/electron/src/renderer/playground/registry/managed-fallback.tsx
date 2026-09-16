// input: Local-only saved connection fixture and production renderer components.
// output: Repeatable QA for fallback preference, notice and actual-model history.
// pos: Development Playground; never accesses credentials or real model providers.
import * as React from "react";
import { useTranslation } from "react-i18next";
import type { LlmConnection } from "@craft-agent/shared/config";
import { ResponseCard } from "@craft-agent/ui";
import { ManagedFallbackSettings } from "@/pages/settings/ManagedFallbackSettings";
import type { ComponentEntry } from "./types";

const STORAGE_KEY = "storyflow-fallback-playground";
function ManagedFallbackPreview() {
  const { t } = useTranslation();
  const [connection, setConnection] = React.useState<LlmConnection>(() => ({
    slug: "storyflow-managed-deepseek",
    name: "DeepSeek",
    providerType: "pi_compat",
    authType: "api_key",
    createdAt: 1,
    autoFallback: localStorage.getItem(STORAGE_KEY) !== "false",
  }));
  const current = React.useRef(connection);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const api = window.electronAPI;
    const previousGet = api.getLlmConnection;
    const previousSave = api.saveLlmConnection;
    api.getLlmConnection = async () => current.current;
    api.saveLlmConnection = async (value) => {
      current.current = value;
      localStorage.setItem(STORAGE_KEY, String(value.autoFallback));
      return { success: true };
    };
    setReady(true);
    return () => {
      api.getLlmConnection = previousGet;
      api.saveLlmConnection = previousSave;
    };
  }, []);
  if (!ready) return null;
  return (
    <div className="w-[640px] max-w-full p-6 space-y-6">
      <ManagedFallbackSettings
        connections={[connection]}
        onSaved={() => setConnection({ ...current.current })}
      />
      <div role="status" className="text-sm text-muted-foreground">
        {t("chat.modelFallback", {
          from: "DeepSeek V4 Flash",
          to: "DeepSeek V4 Pro",
        })}
      </div>
      <ResponseCard
        text="FALLBACK_OK"
        model="deepseek-v4-pro"
        isStreaming={false}
      />
    </div>
  );
}
export const managedFallbackComponents: ComponentEntry[] = [
  {
    id: "managed-fallback",
    name: "Managed Fallback",
    category: "Settings",
    description: "Spec #41: local-only preference and actual model QA",
    component: ManagedFallbackPreview,
    props: [],
  },
];
