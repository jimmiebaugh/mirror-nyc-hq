import type { EntityConfig, EntityType } from "./types";

// Module-level registry of entity configs. Per-entity sub-phases
// (5.9.2 / .3 / .4) import this and call registerEntity() at module load
// via the entities/ barrel.

const registry = new Map<EntityType, EntityConfig>();

export function registerEntity(config: EntityConfig): void {
  registry.set(config.entity_type, config);
}

export function getEntityConfig(entity_type: string): EntityConfig | null {
  return registry.get(entity_type as EntityType) ?? null;
}

export function listRegisteredEntities(): EntityType[] {
  return Array.from(registry.keys());
}
