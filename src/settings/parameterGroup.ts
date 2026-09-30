import type { SettingsRegistry } from "./registry";

/**
 * Holds every boolean member of a group on while the group's own boolean is
 * on, and lets each go back to its own value when it goes off. A held member
 * shows the group as its reason and cannot be changed meanwhile, as with any
 * value the app holds. Returns a function that stops following the group and
 * releases the members.
 */
export function linkParameterGroup(registry: SettingsRegistry, groupId: string, memberIds: readonly string[]): () => void {
  const reason = `On with ${registry.spec(groupId)?.label ?? groupId}.`;
  let releases: (() => void)[] = [];
  const apply = (on: boolean): void => {
    if (on === releases.length > 0) return;
    if (on) releases = memberIds.map(id => registry.force(id, true, reason));
    else {
      for (const release of releases) release();
      releases = [];
    }
  };
  apply(registry.get(groupId) === true);
  const stop = registry.watch(groupId, value => apply(value === true));
  return () => {
    stop();
    apply(false);
  };
}
