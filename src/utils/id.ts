/**
 * Short, collision-free ids for nodes and contours.
 *
 * Ids only need to be unique within a running session (they key React lists,
 * selection sets and undo records), so a counter with a random prefix is
 * cheaper and more debuggable than a UUID.
 */
const PREFIX = Math.floor(Math.random() * 0x7fff)
  .toString(36)
  .padStart(3, '0')

let counter = 0

export function createId(kind = 'n'): string {
  counter += 1
  return `${kind}${PREFIX}${counter.toString(36)}`
}

export function resetIdCounterForTests(): void {
  counter = 0
}
