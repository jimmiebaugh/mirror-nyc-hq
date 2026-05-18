import { useState } from "react";
import { IconCheck, IconCopy, IconEye, IconEyeOff } from "@/components/icons/HQIcons";

/**
 * Masked credential value with eye toggle + copy button. The eye toggle
 * only acts when `maskable` is true (passwords); usernames render plain
 * with a copy button.
 *
 * Copy works regardless of masked state — the actual value is always in
 * the clipboard. Brief checkmark flash on the copy icon confirms.
 */
export function CredentialRevealField({
  value,
  masked,
  maskable = true,
  onToggleMask,
  loading = false,
}: {
  value: string;
  masked: boolean;
  maskable?: boolean;
  onToggleMask?: () => void;
  loading?: boolean;
}) {
  const [justCopied, setJustCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1200);
    } catch {
      // Silent fail — clipboard API requires secure context.
    }
  };

  const showMasked = maskable && masked;
  // Fall back to 8 bullets when masked + no plaintext loaded yet (post-F001
  // reveal is async, so the cached value is empty until the RPC returns).
  const bulletLen = value.length > 0 ? Math.min(12, Math.max(8, value.length)) : 8;
  const display = showMasked ? "•".repeat(bulletLen) : value;

  return (
    <div className="cred">
      <span className={`cv ${showMasked ? "cv--masked" : ""}`}>{display}</span>
      {maskable ? (
        <button
          type="button"
          className="ca"
          onClick={onToggleMask}
          disabled={loading}
          title={loading ? "Loading…" : masked ? "Reveal" : "Hide"}
          aria-label={masked ? "Reveal password" : "Hide password"}
        >
          {masked ? (
            <IconEye className="ic ic-sm" />
          ) : (
            <IconEyeOff className="ic ic-sm" />
          )}
        </button>
      ) : null}
      <button
        type="button"
        className="ca"
        onClick={copy}
        disabled={!value}
        title="Copy"
        aria-label="Copy to clipboard"
      >
        {justCopied ? (
          <IconCheck className="ic ic-sm" style={{ color: "hsl(var(--success))" }} />
        ) : (
          <IconCopy className="ic ic-sm" />
        )}
      </button>
    </div>
  );
}
