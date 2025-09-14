import { validateRequirements } from '../src/core/contracts/Descriptors';

test('validateRequirements passes when all are provided', () => {
    expect(() =>
        validateRequirements('tracer.oneshot', ['generateRay','intersectScene'], new Set(['generateRay','intersectScene','shadeSurface']))
    ).not.toThrow();
});

test('validateRequirements throws when missing', () => {
    expect(() =>
        validateRequirements('tracer.oneshot', ['generateRay','intersectScene'], new Set(['generateRay']))
    ).toThrow(/requires 'intersectScene'/);
});
