import { describe, expect, it } from 'vitest';
import { COLOR_MODELS } from '../../src/components/color/index.js';
import spectrumGLSL from '../../src/components/color/spectrum.glsl?raw';
import { SENSORS } from '../../src/components/sensor/index.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

describe('colour representation and film boundary', () => {
    it.each([2, 3, 4])('spectrum operations compile with %i channels', (n) => {
        // An isolated canary: core transport operations must not assume RGB swizzles.
        // This checks GLSL types; `npm run witness:color` checks numerical behavior.
        glslangCheck(`#version 300 es
precision highp float;
#define Spectrum vec${n}
#define SPECTRUM_N ${n}
${spectrumGLSL}
out vec4 result;
void main() {
    Spectrum s = Spectrum(0.5);
    result = vec4(spectrum_average(s), spectrum_max(s),
                  float(spectrum_is_black(s)), float(spectrum_sample_channel(0.75)));
}`, 'frag', `${n}-channel spectrum`);
    });

    it('RGB sampling and film conversion need no RNG or transport library', () => {
        const rgb = COLOR_MODELS.rgb;
        glslangCheck(`#version 300 es
precision highp float;
#define Direction vec3
${rgb.typesGLSL}
${spectrumGLSL}
${SENSORS.ideal.glsl}
${rgb.glsl}
out vec4 result;
void main() {
    result = vec4(color_to_pixel(vec2(0.0), vec3(0.0, 0.0, 1.0),
                                Spectrum(-0.2, 1.3, 0.5), wavelengths_sample()), 1.0);
}`, 'frag', 'RGB film boundary');
    });

    it.each(['average', 'variance', 'oneshot'] as const)('%s uses the film boundary', (type) => {
        const renderer = new Compiler().compile(minimalScene, {
            ...minimalStrategy,
            estimator: { ...minimalStrategy.estimator, accumulation: { type } },
        });
        const shader = renderer.shaders.get(`${renderer.id}-main`)!.fragment;
        const main = shader.slice(shader.lastIndexOf('void main()'));
        expect(main).toContain('WavelengthSample camera_sample = wavelengths_sample();');
        expect(main).toContain('color_to_pixel(film, ray.direction, L, camera_sample)');
        expect(main.match(/random2\(\)/g)).toHaveLength(2);
        expect(shader.indexOf('#define Spectrum')).toBeLessThan(shader.indexOf('struct LightSample'));
        glslangCheck(shader, 'frag', `${type} film boundary`);
    });
});
