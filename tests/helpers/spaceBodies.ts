// Contract tests over an occupant's GLSL bodies (one per ambient space it implements).

import type { SpaceBodies } from '../../src/components/descriptors.js';

/** Whether `re` matches every body of an occupant (true), none of them (false), or only some
 *  ('some'). Each space's body owes the same symbol contract, so a contract test expects true
 *  or false and a split between spaces fails it. */
export function inEveryBody(glsl: SpaceBodies, re: RegExp): boolean | 'some' {
    const hits = Object.values(glsl).filter((b) => b !== undefined).map((b) => re.test(b.source));
    return hits.every((h) => h) ? true : hits.some((h) => h) ? 'some' : false;
}
