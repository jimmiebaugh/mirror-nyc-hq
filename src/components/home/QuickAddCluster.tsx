import { useNavigate } from "react-router-dom";
import { IconPlus } from "@/components/icons/HQIcons";

const ITEMS = [
  { label: "New Project", to: "/projects/new" },
  { label: "New Task", to: "/tasks/new" },
  { label: "New Deliverable", to: "/deliverables/new" },
  { label: "New Person", to: "/people/new" },
] as const;

/**
 * Home quick-add cluster: four dashed-border chips that route directly to
 * the relevant `/new` form.
 */
export function QuickAddCluster() {
  const navigate = useNavigate();

  return (
    <div className="hq-quickadd">
      {ITEMS.map((item) => (
        <button
          key={item.label}
          type="button"
          className="hq-qa"
          onClick={() => navigate(item.to)}
        >
          <IconPlus className="h-[14px] w-[14px]" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
