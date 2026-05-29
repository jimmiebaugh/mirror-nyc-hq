// Phase 5.16.1.1 §3b (code-observations Frontend #19): presentational split
// of ProjectDetail. The "Team" card (Account Managers + Designers + general
// Members buckets) plus the member-picker Popover. Picker open/search state
// and the add/remove handlers (optimistic join-row updates) all live in the
// parent and arrive via props. JSX only relocated here.
import type { Dispatch, SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { Project } from "@/pages/projects/ProjectDetail";

export function ProjectTeamSection({
  project,
  userOptions,
  memberPickerOpen,
  setMemberPickerOpen,
  memberSearch,
  setMemberSearch,
  handleAddMember,
  handleRemoveMember,
}: {
  project: Project;
  userOptions: { id: string; label: string }[];
  memberPickerOpen: boolean;
  setMemberPickerOpen: Dispatch<SetStateAction<boolean>>;
  memberSearch: string;
  setMemberSearch: Dispatch<SetStateAction<string>>;
  handleAddMember: (userId: string) => Promise<void>;
  handleRemoveMember: (userId: string) => Promise<void>;
}) {
  return (
    <section className="card">
      <div className="card-headbar">
        <span className="h-card">Team</span>
        <Popover
          open={memberPickerOpen}
          onOpenChange={(o) => {
            setMemberPickerOpen(o);
            if (!o) setMemberSearch("");
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="combo-picker-btn"
              aria-label="Add team member"
              title="Add team member"
            >
              <Plus className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="end">
            <Command shouldFilter>
              <CommandInput
                value={memberSearch}
                onValueChange={setMemberSearch}
                placeholder="Search users..."
              />
              <CommandList>
                <CommandEmpty>No users.</CommandEmpty>
                {userOptions.map((opt) => {
                  const isAlreadyOnProject =
                    project.account_managers.some((j) => j.user?.id === opt.id) ||
                    project.designers.some((j) => j.user?.id === opt.id) ||
                    project.members.some((j) => j.user?.id === opt.id);
                  return (
                    <CommandItem
                      key={opt.id}
                      value={opt.label}
                      disabled={isAlreadyOnProject}
                      onSelect={() => {
                        if (isAlreadyOnProject) return;
                        void handleAddMember(opt.id);
                      }}
                      className="cursor-pointer"
                    >
                      <span className="flex-1 truncate">{opt.label}</span>
                      {isAlreadyOnProject ? (
                        <span className="cap" style={{ opacity: 0.6 }}>
                          on project
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <div className="card-pad stack-3">
        {project.account_managers.length === 0 &&
        project.designers.length === 0 &&
        project.members.length === 0 ? (
          <div className="subtle">No team assigned.</div>
        ) : null}
        {project.account_managers.map((j, i) =>
          j.user ? (
            <div key={`am-${i}`} className="row-c">
              <span className="av-i">
                {(j.user.full_name ?? j.user.email ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <div>
                <div>{j.user.full_name ?? j.user.email}</div>
                <div className="cap">Account</div>
              </div>
            </div>
          ) : null,
        )}
        {project.designers.map((j, i) =>
          j.user ? (
            <div key={`d-${i}`} className="row-c">
              <span className="av-i">
                {(j.user.full_name ?? j.user.email ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <div>
                <div>{j.user.full_name ?? j.user.email}</div>
                <div className="cap">Design</div>
              </div>
            </div>
          ) : null,
        )}
        {project.members.map((j, i) =>
          j.user ? (
            <div
              key={`m-${i}`}
              className="row-c team-member-row"
              style={{ justifyContent: "space-between" }}
            >
              <div className="row-c">
                <span className="av-i">
                  {(j.user.full_name ?? j.user.email ?? "?").slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div>{j.user.full_name ?? j.user.email}</div>
                  <div className="cap">Team</div>
                </div>
              </div>
              <button
                type="button"
                className="combo-picker-btn team-member-remove"
                aria-label={`Remove ${j.user.full_name ?? j.user.email ?? "member"} from team`}
                title="Remove from team"
                onClick={() => {
                  if (j.user) void handleRemoveMember(j.user.id);
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}
