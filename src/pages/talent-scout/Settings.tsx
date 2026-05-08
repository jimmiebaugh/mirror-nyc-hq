import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/talent-scout/TagInput";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Phase 3.7.5: Talent Scout global settings page.
 *
 * Currently the only setting that lives here is the global competitor
 * list — used as the seed value for new roles' competitor_bonus.competitors
 * on creation. Editing this list does NOT reach back to existing roles
 * (per Jimmie's spec); existing roles keep whatever's saved on
 * ts_roles.competitor_bonus until edited via Role Settings.
 *
 * Other global settings (Anthropic spend cap, etc.) are still managed
 * directly in the DB / Supabase dashboard for now. This page is scoped to
 * what hiring managers actually need to touch.
 */
export default function TalentScoutSettings() {
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [initial, setInitial] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("global_settings")
        .select("id, talent_scout_competitor_list")
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (error) {
        toast({ title: "Failed to load settings", description: error.message, variant: "destructive" });
        setLoading(false);
        return;
      }
      if (data) {
        setSettingsId(data.id);
        const list = data.talent_scout_competitor_list ?? [];
        setCompetitors(list);
        setInitial(list);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const dirty =
    competitors.length !== initial.length ||
    competitors.some((c, i) => c !== initial[i]);

  const onSave = async () => {
    if (!settingsId) return;
    setSaving(true);
    const { error } = await supabase
      .from("global_settings")
      .update({ talent_scout_competitor_list: competitors })
      .eq("id", settingsId);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setInitial(competitors);
    toast({ title: "Settings saved" });
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <Link
          to="/talent-scout"
          className="text-[14px] font-mono uppercase tracking-widest text-primary hover:underline"
        >
          ← Back to Talent Scout
        </Link>
        <h1 className="h-page">Talent Scout Settings</h1>
        <p className="text-sm text-muted-foreground">
          Global configuration for the Talent Scout tool.
        </p>
      </header>

      <Card className="bg-surface-alt">
        <CardContent className="space-y-3 p-6">
          <div className="space-y-1">
            <div className="label-section">Global Competitor List</div>
            <p className="text-xs text-muted-foreground">
              Used as the default competitor pool for newly created roles. Hit Enter or Tab to add a tag. Changes here apply to future roles only — existing roles keep their saved competitor list until you edit it on Role Settings.
            </p>
          </div>
          <TagInput
            value={competitors}
            onChange={setCompetitors}
            placeholder="Add competitor…"
            caseInsensitiveDedup
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" disabled={!dirty || saving} onClick={() => setCompetitors(initial)}>
          Discard changes
        </Button>
        <Button disabled={!dirty || saving} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
