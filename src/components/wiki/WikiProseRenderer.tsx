/**
 * Renders wiki prose pages. Phase 5.4 feedback round switched body storage
 * from markdown to HTML (authored via TipTap). Bodies are admin-authored
 * + trusted, so we render via dangerouslySetInnerHTML. The `.wikipage.prose`
 * rules in src/index.css handle typography.
 *
 * Empty body renders an empty-state caption instead of a blank panel.
 */
export function WikiProseRenderer({ body }: { body: string | null }) {
  const trimmed = body?.trim();
  if (!trimmed || trimmed === "<p></p>") {
    return (
      <p className="cap" style={{ textAlign: "center", padding: "48px 0" }}>
        This page is empty. Admins can edit it to add content.
      </p>
    );
  }
  return <div dangerouslySetInnerHTML={{ __html: trimmed }} />;
}
