// input: Saved model connections and the existing connection save RPC.
// output: Per-managed-connection automatic fallback switches.
// pos: Settings UI for managed model selection; runtime owns retry behavior.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  isManagedLlmConnectionSlug,
  type LlmConnection,
} from "@config/llm-connections";
import {
  SettingsCard,
  SettingsSection,
  SettingsToggle,
} from "@/components/settings";

export function ManagedFallbackSettings({
  connections,
  onSaved,
}: {
  connections: LlmConnection[];
  onSaved(): void;
}) {
  const { t } = useTranslation();
  const managed = connections.filter((connection) =>
    isManagedLlmConnectionSlug(connection.slug),
  );
  if (!managed.length) return null;
  const save = async (slug: string, autoFallback: boolean) => {
    try {
      const connection = await window.electronAPI.getLlmConnection(slug);
      if (!connection) throw new Error("Connection no longer exists");
      const result = await window.electronAPI.saveLlmConnection({
        ...connection,
        autoFallback,
      });
      if (!result.success) throw new Error(result.error);
      onSaved();
    } catch {
      toast.error(t("settings.ai.fallback.updateFailed"));
    }
  };
  return (
    <SettingsSection
      title={t("settings.ai.fallback.title")}
      description={t("settings.ai.fallback.description")}
    >
      <SettingsCard>
        {managed.map((connection) => (
          <SettingsToggle
            key={connection.slug}
            label={connection.name}
            checked={connection.autoFallback !== false}
            onCheckedChange={(enabled) => void save(connection.slug, enabled)}
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}
