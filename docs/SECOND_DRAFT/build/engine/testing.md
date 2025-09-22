
# Testing Cookbook

## Setup

### Mock WebGL Context
```typescript
import { createMockGL } from './mocks/webgl-mock';

function setupTestGL(): WebGL2RenderingContext {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    // Fall back to mock for CI
    return createMockGL();
  }
  return gl;
}
```

### Test Utilities
```typescript
// Check for WebGL errors
function checkGLError(gl: WebGL2RenderingContext, phase: string): void {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`GL error in ${phase}: ${error}`);
  }
}

// Compile test shader
function compileTestShader(gl: WebGL2RenderingContext, source: string, type: number): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    throw new Error(`Compilation failed: ${log}`);
  }
  
  return shader;
}
```

## Phase 1 Tests

### Triangle Rendering
```typescript
describe('Phase 1: Triangle Renderer', () => {
  let gl: WebGL2RenderingContext;
  let engine: Engine;
  
  beforeEach(() => {
    gl = setupTestGL();
    engine = new Engine(gl);
  });
  
  afterEach(() => {
    engine.dispose();
  });
  
  test('creates engine without errors', () => {
    expect(engine).toBeDefined();
    expect(engine.getState()).toBe('ready');
  });
  
  test('renders without WebGL errors', () => {
    engine.renderFrame();
    checkGLError(gl, 'renderFrame');
  });
  
  test('executor initializes geometry', () => {
    const executor = new RenderExecutor(gl);
    executor.setupGeometry();
    expect(executor.isInitialized()).toBe(true);
  });
  
  test('renders multiple frames', () => {
    for (let i = 0; i < 10; i++) {
      engine.renderFrame();
      checkGLError(gl, `frame ${i}`);
    }
  });
});
```

### Visual Validation
```typescript
test('triangle covers screen', async () => {
  engine.renderFrame();
  
  // Read center pixel
  const pixels = new Float32Array(4);
  gl.readPixels(640, 360, 1, 1, gl.RGBA, gl.FLOAT, pixels);
  
  // Should be magenta (1, 0, 1, 1)
  expect(pixels[0]).toBeCloseTo(1.0, 2);
  expect(pixels[1]).toBeCloseTo(0.0, 2);
  expect(pixels[2]).toBeCloseTo(1.0, 2);
  expect(pixels[3]).toBeCloseTo(1.0, 2);
});
```

## Phase 2 Tests

### Uniform Updates
```typescript
describe('Phase 2: Uniform System', () => {
  test('builds uniform mappings', () => {
    const binder = new UniformBinder(gl);
    const program = createTestProgram(gl);
    
    binder.buildBindings(program);
    const map = binder.getUniformMap();
    
    expect(map).toBeDefined();
    expect(map.getMapping('engine.resolution')).toBeDefined();
    expect(map.getMapping('engine.time')).toBeDefined();
  });
  
  test('queues and flushes updates', () => {
    binder.queueUpdate('test.value', 42);
    expect(binder.getPendingCount()).toBe(1);
    
    binder.frameUpdate({
      width: 1920,
      height: 1080,
      frameIndex: 0,
      sampleCount: 0,
      time: 0
    });
    
    expect(binder.getPendingCount()).toBe(0);
  });
  
  test('time uniform changes value', () => {
    engine.renderFrame();
    const pixels1 = readPixel(gl, 640, 360);
    
    // Wait a bit
    setTimeout(() => {
      engine.renderFrame();
      const pixels2 = readPixel(gl, 640, 360);
      
      // Color should have changed
      expect(pixels2[0]).not.toBeCloseTo(pixels1[0], 2);
    }, 100);
  });
});
```

## Phase 3 Tests

### Module Registration
```typescript
describe('Phase 3: Module System', () => {
  let registry: ModuleRegistry;
  
  beforeEach(() => {
    registry = new ModuleRegistry();
  });
  
  test('registers module', () => {
    const module: ModuleDescriptor = {
      id: { kind: 'camera', name: 'test', version: '1.0.0' },
      fragment: {
        functions: 'Ray generate_ray(vec2 p, vec2 xi) { return Ray(); }',
        provides: ['generate_ray']
      }
    };
    
    registry.register(module);
    expect(registry.has('camera', 'test')).toBe(true);
  });
  
  test('validates dependencies', () => {
    const camera = createTestCamera();
    const estimator = createTestEstimator();
    
    registry.register(camera);
    registry.register(estimator);
    
    const validation = registry.validateDependencies([camera, estimator]);
    expect(validation.satisfied).toBe(true);
  });
  
  test('detects missing dependencies', () => {
    const badModule: ModuleDescriptor = {
      id: { kind: 'estimator', name: 'bad', version: '1.0.0' },
      fragment: {
        functions: '',
        requires: ['nonexistent_function']
      }
    };
    
    const validation = registry.validateDependencies([badModule]);
    expect(validation.satisfied).toBe(false);
    expect(validation.missing).toHaveLength(1);
  });
});
```

### Simple Compilation
```typescript
test('compiles with SimplePipeline', () => {
  const compiler = new ShaderCompiler(gl, registry);
  const pipeline = new SimplePipeline(gl);
  compiler.setPipeline(pipeline);
  
  const recipe: Recipe = {
    id: 'test',
    name: 'Test Recipe',
    world: {
      geometry: { kind: 'geometry', name: 'euclidean' },
      // ... other modules
    },
    photography: {
      camera: { kind: 'camera', name: 'test' },
      // ... other modules
    }
  };
  
  const program = compiler.compile(recipe);
  expect(program).toBeDefined();
  expect(gl.isProgram(program.program)).toBe(true);
});
```

## Phase 4 Tests

### Resource Management
```typescript
describe('Phase 4: Resources', () => {
  let resources: ResourceManager;
  
  beforeEach(() => {
    resources = new ResourceManager(gl);
  });
  
  test('reports capabilities', () => {
    const caps = resources.getCapabilities();
    expect(caps).toBeDefined();
    expect(typeof caps.maxTextureSize).toBe('number');
  });
  
  test('creates texture', () => {
    const texture = resources.createTexture({
      id: 'test',
      width: 256,
      height: 256,
      format: TextureFormat.RGBA32F,
      type: DataType.FLOAT
    });
    
    expect(texture).toBeDefined();
    expect(gl.isTexture(texture.glTexture)).toBe(true);
  });
  
  test('creates complete framebuffer', () => {
    const texture = resources.createTexture({
      id: 'color',
      width: 256,
      height: 256,
      format: TextureFormat.RGBA32F,
      type: DataType.FLOAT
    });
    
    const fb = resources.createFramebuffer({
      id: 'test_fb',
      attachments: [{
        type: 'color',
        texture
      }],
      width: 256,
      height: 256
    });
    
    expect(fb.complete).toBe(true);
  });
  
  test('accumulates over frames', () => {
    // Render frame 1
    engine.renderFrame();
    const pixels1 = readPixels(gl);
    
    // Render frame 2 (should accumulate)
    engine.renderFrame();
    const pixels2 = readPixels(gl);
    
    // Brightness should increase
    const brightness1 = pixels1[0] + pixels1[1] + pixels1[2];
    const brightness2 = pixels2[0] + pixels2[1] + pixels2[2];
    expect(brightness2).toBeGreaterThan(brightness1);
  });
});
```

## Phase 5 Tests

### Pipeline Stages
```typescript
describe('Phase 5: Compilation Pipeline', () => {
  test('CollectModulesStage', () => {
    const stage = new CollectModulesStage();
    const modules = createTestModuleCollection();
    
    const result = stage.execute(modules, context);
    expect(result).toHaveLength(8);
    expect(result[0].descriptor.id.kind).toBe('geometry');
  });
  
  test('ApplyPrefixesStage', () => {
    const stage = new ApplyPrefixesStage();
    const modules = [createTestCameraModule()];
    
    const result = stage.execute(modules, context);
    expect(result[0].prefixedSource).toContain('c_generate_ray');
    expect(result[0].functionMap.get('generate_ray')).toBe('c_generate_ray');
  });
  
  test('ValidateDependenciesStage', () => {
    const stage = new ValidateDependenciesStage();
    const modules = [
      createModuleWithProvides(['foo']),
      createModuleWithRequires(['foo'])
    ];
    
    const validation = stage.validate(modules);
    expect(validation.valid).toBe(true);
  });
  
  test('full pipeline execution', () => {
    const pipeline = new StandardCompilationPipeline(gl);
    const modules = createFullModuleSet();
    
    const result = pipeline.execute(context, modules);
    expect(result.glProgram).toBeDefined();
    expect(result.uniformMap).toBeDefined();
    expect(result.stagesExecuted).toHaveLength(8);
  });
});
```

## Integration Tests

### Recipe Switching
```typescript
test('switches recipes instantly', async () => {
  const engine = new Engine(gl);
  
  engine.initialize([recipeA, recipeB]);
  
  // Time first switch
  engine.selectRecipe('recipeA');
  const start = performance.now();
  engine.selectRecipe('recipeB');
  const elapsed = performance.now() - start;
  
  expect(elapsed).toBeLessThan(10); // Should be < 10ms
});
```

### Context Loss Recovery
```typescript
test('recovers from context loss', async () => {
  const loseContext = gl.getExtension('WEBGL_lose_context');
  
  // Trigger loss
  loseContext.loseContext();
  await waitForContextLoss();
  
  // Trigger restore
  loseContext.restoreContext();
  await waitForContextRestore();
  
  // Should be able to render again
  engine.renderFrame();
  checkGLError(gl, 'post-recovery');
});
```

## Performance Tests

```typescript
describe('Performance', () => {
  test('maintains 60fps', async () => {
    const frames = 100;
    const start = performance.now();
    
    for (let i = 0; i < frames; i++) {
      engine.renderFrame();
    }
    
    const elapsed = performance.now() - start;
    const fps = frames / (elapsed / 1000);
    
    expect(fps).toBeGreaterThan(60);
  });
  
  test('compilation under time limit', () => {
    const start = performance.now();
    const program = compiler.compile(complexRecipe);
    const elapsed = performance.now() - start;
    
    expect(elapsed).toBeLessThan(500);
  });
});
```

## Debugging Helpers

```typescript
// Visual debugging
function saveCanvasImage(gl: WebGL2RenderingContext, filename: string): void {
  const canvas = gl.canvas as HTMLCanvasElement;
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  });
}

// Shader debugging
function logShaderSource(program: CompiledProgram): void {
  console.log('=== VERTEX SHADER ===');
  console.log(program.metadata.vertexSource);
  console.log('=== FRAGMENT SHADER ===');
  console.log(program.metadata.fragmentSource);
}

// Uniform debugging
function logActiveUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  console.log(`Active uniforms: ${count}`);
  
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    console.log(`  ${info.name}: ${info.type}`);
  }
}
```
