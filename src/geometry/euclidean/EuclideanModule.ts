import type { GeometryModule } from "../../core/types";
import EuclideanGeometryPlugin from "./EuclideanPlugin";
import EuclideanRuntime from "./EuclideanRuntime";
import type {EucFrame} from "./EuclideanRuntime";

/** Euclidean module = shader plugin + runtime (CPU frame owner). */
export default class EuclideanModule implements GeometryModule<EucFrame> {
    readonly shader = new EuclideanGeometryPlugin();
    readonly runtime = new EuclideanRuntime();
}

/** Convenience: construct a module and a fresh default frame. */
export function createEuclideanModule() {
    const module = new EuclideanModule();
    const frame = module.runtime.createDefaultFrame();
    return { module, frame }; // { module.shader, module.runtime, frame }
}
