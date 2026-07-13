// Transport-integrator registry (pick-one family, fable-components §3/§7). One occupant
// today; the strategy-level integrator axis arrives with the second occupant (one-shot,
// Whitted, and debug probes are new walks COMPOSING the existing techniques — see pt.ts's
// header for what an integrator owns vs what techniques own).

import { contributeTransport } from './pt.js';

export const INTEGRATORS = {
    pt: contributeTransport,
};
