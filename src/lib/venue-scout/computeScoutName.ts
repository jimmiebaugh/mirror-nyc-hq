// vs_scouts.name is required (NOT NULL). The producer never enters it
// directly; New Scout collects client_name + event_name and we synthesize
// the display name as `${client_name} - ${event_name}`. Centralized so
// downstream renames or formatting tweaks live in one place.
export function computeScoutName(clientName: string, eventName: string): string {
  return `${clientName.trim()} - ${eventName.trim()}`;
}
