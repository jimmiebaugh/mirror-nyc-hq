import { QuickAddCluster } from "@/components/home/QuickAddCluster";

function timeOfDayGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(fullName?: string | null, email?: string | null): string {
  if (fullName?.trim()) return fullName.trim().split(/\s+/)[0];
  if (email) return email.split("@")[0].split(".")[0].replace(/^./, (c) => c.toUpperCase());
  return "there";
}

function formatLongDate(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Phase 5.1 Home greeting (spec § 7a step 1).
 *
 * Eyebrow: coral mono "Thursday · May 14, 2026" (live date).
 * Title: sentence-case "Good morning, {first_name}". Sentence case is a
 * deliberate exception to the all-caps page-title rule for Home only.
 * Right side: the QuickAddCluster.
 */
export function Greeting({
  fullName,
  email,
}: {
  fullName?: string | null;
  email?: string | null;
}) {
  return (
    <div className="flex flex-row items-end justify-between gap-5">
      <div>
        <div className="eyebrow">{formatLongDate()}</div>
        <h1
          className="mt-[6px] text-[34px] font-extrabold leading-[1.05] tracking-[-0.01em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {timeOfDayGreeting()}, {firstName(fullName, email)}
        </h1>
      </div>
      <QuickAddCluster />
    </div>
  );
}