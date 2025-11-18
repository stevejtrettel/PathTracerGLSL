# Error Handling Strategy — Problem Description

## 1. Context and Challenge

The Compiler transforms user scene descriptions through multiple phases (analysis → organization → code generation) into final GLSL shaders. Errors can occur at any stage, but the user only sees their original scene description, not the complex transformations or generated GLSL.

**Core challenge:** When something goes wrong in generated GLSL line 1247, how do we tell the user it's actually a problem in their `scene.ts` line 45, column 12, in material 'glass' property 'albedo'?

---

## 2. Types of Errors

### 2.1. Analysis Errors (Phase 1)

Problems detected while inspecting the scene description.

**Examples:**
- Unknown object type: `{ type: 'spheer' }` (typo)
- Missing required property: `{ type: 'sphere' }` (no radius)
- Invalid parameter type: `{ radius: "large" }` (should be number)
- Material reference doesn't exist: `material: 'glas'` (typo)
- Circular material dependencies

**Characteristics:**
- Occur before any code generation
- Can be detected with rich context
- TypeScript might catch some already
- Can provide suggestions (did you mean 'sphere'?)

**Error location:**
```typescript
// scene.ts:45
objects: [
  {
    type: 'spheer',  // ← Error here
    radius: 1.0
  }
]
```

**What we know:**
- Exact TypeScript file location
- Surrounding code context
- Expected types/values
- Available alternatives

---

### 2.2. Semantic Errors (Phase 1-2)

Problems with the logical structure, detected during analysis or organization.

**Examples:**
- Conflicting requirements: Variant needs volumes but scene has none
- Unsupported feature combination: "Cannot use MIS with debug renderer"
- Resource constraints: "Too many lights (max 32)"
- Impossible configuration: "Emissive material has no geometry"

**Characteristics:**
- Detected after parsing but before generation
- May span multiple parts of scene definition
- Often about relationships between parts

**Error location:**
```typescript
// scene.ts
const scene = {
  objects: [], // Empty - no geometry
  materials: {
    light: { emission: [10, 10, 10] }  // ← Error: emissive with no objects
  }
};
```

**What we know:**
- Multiple locations may be relevant
- Can explain the constraint
- Can suggest fixes

---

### 2.3. Generation Errors (Phase 3)

Problems during GLSL code generation.

**Examples:**
- Name collision: Two objects both get ID `obj_0`
- Invalid GLSL identifier: Object ID `my-sphere` → `sdf_my-sphere` (invalid)
- Template rendering failure
- Resource limit exceeded (shader too large)

**Characteristics:**
- Occur during code generation
- May not map cleanly to user code
- Often infrastructure bugs, not user errors

**Error location:**
```typescript
// scene.ts:45
{
  id: 'my-sphere',  // ← Invalid GLSL identifier (hyphen)
  geometry: { type: 'sphere' }
}
```

**What we know:**
- Which generation function failed
- What data caused the problem
- Can trace back to source object/property

---

### 2.4. GLSL Compilation Errors (Engine Phase)

The WebGL compiler rejects our generated GLSL.

**Examples:**
- Type mismatch: `vec3 x = vec2(1.0, 2.0);`
- Undefined function: `result = my_helper(p);`
- Syntax error: Missing semicolon, unmatched brace
- Uniform/varying mismatch between vertex and fragment

**Characteristics:**
- Occur after successful generation
- GLSL compiler reports line numbers in generated code
- Need source maps to trace back to user code
- Most critical for user-written procedural code

**Error location:**
```typescript
// scene.ts:78
material: {
  albedo: `
    vec3 compute(vec3 p, vec3 n, vec2 uv) {
      return vec3(p.x, p.y);  // ← Type error: returns vec2, expects vec3
    }
  `
}
```

**What we know:**
- GLSL error message and line number
- Generated GLSL around the error
- Need source map to find user code

---

## 3. Source Map Requirements

Source maps are the key to good errors for generated code.

### 3.1. What Needs Mapping

**User code → Generated GLSL:**
```typescript
// User writes (scene.ts:78, col 12)
albedo: `vec3 compute(vec3 p) { return vec3(p.x, p.y, 0.5); }`

// Generates to (shader.frag:234)
vec3 material_glass_albedo(vec3 p, vec3 n, vec2 uv) {
  return vec3(p.x, p.y, 0.5);
}
```

**Mapping entry:**
```typescript
{
  generatedLine: 234,
  generatedColumn: 0,
  originalFile: 'scene.ts',
  originalLine: 78,
  originalColumn: 12,
  context: "material 'glass' property 'albedo'"
}
```

### 3.2. Source Map Structure

```typescript
interface SourceMap {
  version: number;  // Source map version (always 3)
  file: string;     // Generated file name
  
  // Compact encoding (VLQ format) - standard source map format
  mappings: string;
  
  // OR explicit mappings (easier to work with)
  entries: SourceMapEntry[];
}

interface SourceMapEntry {
  // Location in generated GLSL
  generatedLine: number;
  generatedColumn: number;
  
  // Location in user's code
  originalFile: string;
  originalLine: number;
  originalColumn: number;
  
  // Additional context for better errors
  context?: string;  // "material 'glass' property 'albedo'"
  name?: string;     // Original identifier name if relevant
}
```

### 3.3. Granularity Tradeoffs

**Line-level mapping** (simpler):
```typescript
// Just track which generated lines came from which user lines
{
  generatedLine: 234,
  originalFile: 'scene.ts',
  originalLine: 78,
  context: "material 'glass'"
}
```

**Column-level mapping** (standard source maps):
```typescript
// Track exact positions
{
  generatedLine: 234,
  generatedColumn: 25,
  originalLine: 78,
  originalColumn: 42
}
```

**Token-level mapping** (most precise):
```typescript
// Track individual tokens/expressions
{
  generatedSpan: { line: 234, colStart: 25, colEnd: 45 },
  originalSpan: { file: 'scene.ts', line: 78, colStart: 42, colEnd: 62 },
  tokenType: 'expression'
}
```

**Question:** What granularity do we need?
- Line-level may be sufficient for most errors
- Column-level needed for inline procedural code
- Token-level is overkill unless we're building an IDE

---

## 4. Error Message Design

### 4.1. Message Structure

```typescript
interface CompilationError {
  // Error classification
  severity: 'error' | 'warning';
  stage: 'analysis' | 'generation' | 'glsl';
  category: string;  // 'type-error', 'missing-property', 'glsl-syntax', etc.
  
  // Primary message
  message: string;
  
  // Location information
  location: ErrorLocation;
  
  // Additional context
  notes?: string[];      // Additional information
  suggestions?: string[]; // How to fix it
  relatedLocations?: ErrorLocation[];  // Other relevant places
  
  // For GLSL errors
  glslError?: {
    line: number;
    message: string;
    snippet: string;  // Generated GLSL around error
  };
}

interface ErrorLocation {
  file: string;
  line: number;
  column: number;
  context?: string;  // Human-readable context
  snippet?: CodeSnippet;
}

interface CodeSnippet {
  beforeLines: string[];  // Lines before error
  errorLine: string;      // Line with error
  afterLines: string[];   // Lines after error
  highlightColumn: number; // Where to put the ^
  highlightLength: number; // How many characters to highlight
}
```

### 4.2. Display Format

**Example 1: Analysis Error**
```
❌ Error in scene.ts:45:12 (object 'globe')

Unknown geometry type 'spheer'

   43 | objects: [
   44 |   {
 > 45 |     type: 'spheer',
      |            ^^^^^^^^
   46 |     radius: 1.0
   47 |   }

Suggestions:
  • Did you mean 'sphere'?
  • Available types: sphere, box, cylinder, torus, custom
```

**Example 2: GLSL Compilation Error**
```
❌ GLSL compilation failed in scene.ts:78:12 (material 'glass' property 'albedo')

Type mismatch: Cannot convert vec2 to vec3

User code:
   76 | material: {
   77 |   glass: {
 > 78 |     albedo: `vec3 compute(vec3 p) { return vec3(p.x, p.y); }`
      |                                            ^^^^^^^^^^^^^^^^^
   79 |   }
   80 | }

Generated GLSL (line 234):
  233 | vec3 material_glass_albedo(vec3 p, vec3 n, vec2 uv) {
> 234 |   return vec3(p.x, p.y);  // ← Your code
      |          ^^^^^^^^^^^^^^^
  235 | }

Note: vec3 constructor requires 3 arguments, but only 2 provided

Suggestions:
  • Add third component: vec3(p.x, p.y, 0.5)
  • Or use vec3(value) to broadcast: vec3(0.5)
```

**Example 3: Semantic Error**
```
❌ Error in scene.ts (multiple locations)

Variant 'production' requires volumetric rendering, but no objects have volumes

Variant definition (line 15):
   13 | variants: [
   14 |   {
 > 15 |     id: 'production',
      |     ^^^^^^^^^^^^^^^^^^
   16 |     needsVolumes: true  // ← Enabled here
   17 |   }

Scene definition (line 45):
 > 45 | objects: [
      | ^^^^^^^^^
   46 |   { type: 'sphere', material: 'glass' },
   47 |   { type: 'box', material: 'wood' }
      |   // ← No volumetric objects

Suggestions:
  • Add a volumetric object (fog, glass, water)
  • Or set needsVolumes: false in variant
  • Or add volumes: true to an object's material
```

### 4.3. Error Message Priorities

1. **Location accuracy**: User must know exactly where the problem is
2. **Clear description**: What went wrong in plain language
3. **Context**: Why is this a problem?
4. **Actionable suggestions**: How to fix it
5. **Related info**: Other relevant locations/facts

---

## 5. Suggestion System

### 5.1. Typo Detection (Levenshtein Distance)

```typescript
function suggestTypoFix(input: string, validOptions: string[]): string[] {
  const suggestions = validOptions
    .map(option => ({
      option,
      distance: levenshteinDistance(input, option)
    }))
    .filter(({ distance }) => distance <= 2)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(({ option }) => option);
  
  return suggestions;
}

// Usage:
const input = 'spheer';
const valid = ['sphere', 'box', 'cylinder', 'torus'];
const suggestions = suggestTypoFix(input, valid);
// Returns: ['sphere']
```

### 5.2. Context-Aware Suggestions

```typescript
class SuggestionEngine {
  suggestForError(error: CompilationError): string[] {
    switch (error.category) {
      case 'unknown-type':
        return this.suggestObjectTypes(error);
      
      case 'missing-property':
        return this.suggestMissingProperty(error);
      
      case 'type-mismatch':
        return this.suggestTypeConversion(error);
      
      case 'glsl-syntax':
        return this.suggestGLSLFix(error);
      
      default:
        return [];
    }
  }
  
  private suggestObjectTypes(error: CompilationError): string[] {
    const invalidType = error.metadata.invalidType;
    const validTypes = error.metadata.validTypes;
    
    // Typo suggestions
    const typoSuggestions = suggestTypoFix(invalidType, validTypes);
    
    // Contextual suggestions
    const contextual = [];
    if (error.location.context?.includes('simple')) {
      contextual.push("For simple objects, try: 'sphere', 'box', 'cylinder'");
    }
    
    return [...typoSuggestions, ...contextual];
  }
}
```

### 5.3. Common Error Patterns

**Pattern 1: Wrong vector size**
```typescript
// Error: vec3 x = vec2(1.0, 2.0);
suggestions: [
  "Add missing component: vec3(1.0, 2.0, 0.0)",
  "Or use vec2 instead of vec3: vec2 x = vec2(1.0, 2.0)",
  "Or broadcast single value: vec3(1.0) creates vec3(1.0, 1.0, 1.0)"
]
```

**Pattern 2: Missing return**
```typescript
// Error: Function 'compute' doesn't return on all paths
suggestions: [
  "Add return statement at end of function",
  "Check your if/else branches all return",
  "For void functions, use return; without a value"
]
```

**Pattern 3: Name conflicts**
```typescript
// Error: Identifier 'my-sphere' contains invalid character
suggestions: [
  "Use underscores instead: 'my_sphere'",
  "Use camelCase: 'mySphere'",
  "Remove hyphens: 'mysphere'"
]
```

---

## 6. Implementation Strategies

### 6.1. Source Map Construction (During Generation)

**Strategy A: Build while generating**
```typescript
class CodeGenerator {
  private sourceMap = new SourceMapBuilder();
  private currentLine = 0;
  
  emit(code: string, source?: SourceLocation): void {
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      if (source && i === 0) {
        // First line of emitted code maps to source
        this.sourceMap.addMapping({
          generatedLine: this.currentLine,
          generatedColumn: 0,
          originalFile: source.file,
          originalLine: source.line,
          originalColumn: source.column,
          context: source.context
        });
      }
      this.currentLine++;
    }
  }
}

// Usage:
generator.emit('vec3 albedo;', {
  file: 'scene.ts',
  line: 45,
  column: 12,
  context: "material 'glass'"
});
```

**Strategy B: Post-process with markers**
```typescript
// During generation, embed markers
function generateMaterialCode(material: Material): string {
  return `
    /*SOURCE:scene.ts:45:12:material-glass*/
    vec3 material_glass_albedo(vec3 p) {
      /*SOURCE:scene.ts:78:20:albedo-compute*/
      return vec3(p.x, p.y, 0.5);
    }
  `;
}

// After generation, parse markers to build source map
function extractSourceMap(glsl: string): SourceMap {
  const lines = glsl.split('\n');
  const map = new SourceMapBuilder();
  
  lines.forEach((line, idx) => {
    const match = line.match(/\/\*SOURCE:([^*]+)\*\//);
    if (match) {
      const [file, line, col, context] = match[1].split(':');
      map.addMapping({
        generatedLine: idx,
        originalFile: file,
        originalLine: parseInt(line),
        originalColumn: parseInt(col),
        context
      });
    }
  });
  
  return map.build();
}
```

**Strategy C: Track in data structure**
```typescript
interface GeneratedCode {
  glsl: string;
  sourceMap: SourceMap;
}

// Every generation function returns both
function generateMaterialCode(material: Material): GeneratedCode {
  const glsl = `vec3 material_${material.id}_albedo(vec3 p) { ... }`;
  const sourceMap = {
    entries: [{
      generatedLine: 0,
      originalFile: material.sourceLocation.file,
      originalLine: material.sourceLocation.line,
      // ...
    }]
  };
  
  return { glsl, sourceMap };
}

// Concatenate preserves mappings
function concatenate(codes: GeneratedCode[]): GeneratedCode {
  let glsl = '';
  let currentLine = 0;
  const allEntries: SourceMapEntry[] = [];
  
  for (const code of codes) {
    glsl += code.glsl + '\n';
    
    // Adjust line numbers
    for (const entry of code.sourceMap.entries) {
      allEntries.push({
        ...entry,
        generatedLine: entry.generatedLine + currentLine
      });
    }
    
    currentLine += code.glsl.split('\n').length;
  }
  
  return { glsl, sourceMap: { entries: allEntries } };
}
```

**Recommended:** Strategy C (explicit tracking) - most robust, composable

---

### 6.2. Error Translation (GLSL → User Code)

```typescript
class ErrorTranslator {
  constructor(private sourceMap: SourceMap) {}
  
  translateGLSLError(glslError: GLSLError): CompilationError {
    // Find source map entry for this line
    const mapping = this.sourceMap.entries.find(
      entry => entry.generatedLine === glslError.line
    );
    
    if (!mapping) {
      // No mapping - error in generated infrastructure code
      return {
        severity: 'error',
        stage: 'glsl',
        category: 'internal',
        message: 'GLSL compilation error in generated code',
        location: { file: 'generated', line: glslError.line, column: 0 },
        glslError: {
          line: glslError.line,
          message: glslError.message,
          snippet: this.getGLSLSnippet(glslError.line)
        },
        notes: [
          'This error occurred in compiler-generated code.',
          'Please report this as a bug.'
        ]
      };
    }
    
    // Error in user code - translate
    return {
      severity: 'error',
      stage: 'glsl',
      category: this.categorizeGLSLError(glslError),
      message: this.humanizeGLSLError(glslError),
      location: {
        file: mapping.originalFile,
        line: mapping.originalLine,
        column: mapping.originalColumn,
        context: mapping.context,
        snippet: this.getUserCodeSnippet(mapping)
      },
      glslError: {
        line: glslError.line,
        message: glslError.message,
        snippet: this.getGLSLSnippet(glslError.line)
      },
      suggestions: this.suggestFixForGLSLError(glslError, mapping)
    };
  }
  
  private categorizeGLSLError(error: GLSLError): string {
    if (error.message.includes('type mismatch')) return 'type-mismatch';
    if (error.message.includes('undefined')) return 'undefined-reference';
    if (error.message.includes('syntax')) return 'syntax-error';
    return 'glsl-error';
  }
  
  private humanizeGLSLError(error: GLSLError): string {
    // Transform cryptic GLSL errors into friendly messages
    if (error.message.includes('no matching function')) {
      return 'Function call has wrong number or type of arguments';
    }
    if (error.message.includes('type mismatch in initialization')) {
      return 'Cannot assign value of wrong type to variable';
    }
    return error.message;
  }
}
```

---

### 6.3. Error Recovery

**Question:** When compilation fails, what should we do?

**Option 1: Fail fast**
```typescript
compile(recipe: Recipe): CompiledRecipe | CompilationError {
  const analysis = this.analyzeScene(recipe.scene);
  if (analysis.errors.length > 0) {
    return analysis.errors[0];  // Return first error
  }
  // ...
}
```

**Option 2: Collect all errors**
```typescript
compile(recipe: Recipe): CompiledRecipe | CompilationError[] {
  const errors: CompilationError[] = [];
  
  // Continue even after errors
  const analysis = this.analyzeScene(recipe.scene);
  errors.push(...analysis.errors);
  
  if (errors.length > 0) {
    return errors;  // Return all errors found
  }
  // ...
}
```

**Option 3: Partial compilation**
```typescript
compile(recipe: Recipe): PartialResult {
  const results = {
    variants: new Map<string, CompiledVariant | CompilationError>()
  };
  
  for (const variant of recipe.variants) {
    try {
      results.variants.set(variant.id, this.compileVariant(variant));
    } catch (error) {
      results.variants.set(variant.id, error);
    }
  }
  
  return results;  // Some variants succeed, some fail
}
```

**Recommended:** Option 2 for analysis errors (collect all), Option 1 for generation errors (fail on first GLSL error)

---

## 7. Testing Error Messages

How do we ensure error messages are actually helpful?

### 7.1. Error Message Tests

```typescript
describe('Error Messages', () => {
  it('should give helpful message for unknown type', () => {
    const scene = {
      objects: [{ type: 'spheer', radius: 1.0 }]
    };
    
    const result = compiler.compile({ scene, variants: [] });
    
    expect(result.errors[0]).toMatchObject({
      message: expect.stringContaining('Unknown geometry type'),
      location: { file: 'scene.ts', line: 45 },
      suggestions: expect.arrayContaining([
        expect.stringContaining("Did you mean 'sphere'?")
      ])
    });
  });
  
  it('should map GLSL errors to user code', () => {
    const scene = {
      materials: {
        glass: {
          albedo: `vec3 compute(vec3 p) { return vec3(p.x, p.y); }`
        }
      }
    };
    
    const result = compiler.compile({ scene, variants: [] });
    
    expect(result.errors[0]).toMatchObject({
      stage: 'glsl',
      location: {
        file: 'scene.ts',
        line: 78,  // User's code
        context: "material 'glass' property 'albedo'"
      },
      glslError: {
        line: 234,  // Generated code
        message: expect.stringContaining('type mismatch')
      }
    });
  });
});
```

### 7.2. Smoke Testing with Real Errors

```typescript
// Deliberately broken examples
const brokenExamples = {
  'typo-in-type': { objects: [{ type: 'spheer' }] },
  'missing-radius': { objects: [{ type: 'sphere' }] },
  'wrong-vec-size': { materials: { m: { albedo: `vec3 c() { return vec3(1,2); }` } } },
  'undefined-material': { objects: [{ type: 'sphere', material: 'nonexistent' }] },
  'glsl-syntax': { materials: { m: { albedo: `vec3 c() { return vec3(1,2,3) }` } } }
};

for (const [name, scene] of Object.entries(brokenExamples)) {
  test(`Error for ${name} should be helpful`, () => {
    const result = compiler.compile({ scene, variants: [] });
    expect(result.errors[0].message).toBeTruthy();
    expect(result.errors[0].location.line).toBeGreaterThan(0);
    expect(result.errors[0].suggestions.length).toBeGreaterThan(0);
  });
}
```

---

## 8. Error Message Evolution

Errors should improve over time:

### 8.1. Error Metrics

Track which errors users hit most:
```typescript
interface ErrorMetrics {
  category: string;
  count: number;
  averageTimeToResolve?: number;  // If we track this
}

// Log anonymized errors
logger.logError({
  category: error.category,
  stage: error.stage,
  wasHelpful: user.resolved  // If we can detect
});
```

### 8.2. Iterative Improvement

1. **Launch with basic errors** - clear message + location
2. **Add suggestions** for common patterns
3. **Improve translation** of GLSL errors
4. **Add related locations** for multi-part errors
5. **Add quick fixes** (if building tooling)

---

## 9. Key Decision Points

### 9.1. Source Map Granularity
- Line-level only (simpler)
- Column-level (more precise)
- Token-level (overkill?)

### 9.2. Error Recovery
- Fail on first error
- Collect all errors
- Partial compilation

### 9.3. Suggestion Sophistication
- Just typo detection
- Pattern-based suggestions
- LLM-powered suggestions (future?)

### 9.4. Display Format
- Plain text (terminal-friendly)
- Rich formatting (colors, highlighting)
- HTML (for web view)

### 9.5. Testing Strategy
- Unit tests for error detection
- Smoke tests with broken examples
- User testing with real scenarios

---

## 10. Open Questions

1. **How much context to show?**
   - Just error line?
   - ±3 lines?
   - Entire function/object?

2. **Should we show generated GLSL?**
   - Always (more info, might confuse)
   - Only on request (cleaner, less helpful)
   - Only for "advanced mode"

3. **How to handle cascading errors?**
   - One error causes many downstream
   - Show all or just root cause?

4. **Error codes vs messages?**
   - Error codes (E001, E002) for searchability
   - Just natural language messages
   - Both?

5. **Interactive fixes?**
   - Just suggestions
   - Offer to auto-fix (if building tooling)
   - Generate corrected code

6. **Internationalization?**
   - English only
   - Support multiple languages
   - Community translations

---

## 11. Recommended Starting Point

**Phase 1: Core Errors (MVP)**
- Line-level source maps
- Basic error categories (analysis, generation, glsl)
- Clear messages with location
- Simple typo suggestions

**Phase 2: Better Diagnostics**
- Column-level source maps
- Code snippets in errors
- Pattern-based suggestions
- Related locations

**Phase 3: Advanced Features**
- Rich error display
- Context-aware suggestions
- Error recovery
- Metrics and improvement loop

Start simple, iterate based on what errors users actually hit.

---

## 12. Example Implementation Sketch

```typescript
class Compiler {
  compile(recipe: Recipe): CompilationResult {
    const errors: CompilationError[] = [];
    
    // Phase 1: Analysis
    try {
      const analysis = this.analyzeScene(recipe.scene);
      errors.push(...analysis.errors);
      if (errors.length > 0) {
        return { success: false, errors };
      }
    } catch (error) {
      return {
        success: false,
        errors: [this.wrapUnexpectedError(error, 'analysis')]
      };
    }
    
    // Phase 2: Organization
    const groups = this.groupByRequirements(analysis, recipe.variants);
    
    // Phase 3: Generation
    const variants = new Map();
    for (const group of groups) {
      try {
        const code = this.generateSceneCode(analysis, group.requirements);
        
        // Try to compile GLSL
        const glslResult = this.validateGLSL(code.glsl);
        if (!glslResult.success) {
          // Translate GLSL errors using source map
          const translatedErrors = glslResult.errors.map(e =>
            this.errorTranslator.translateGLSLError(e, code.sourceMap)
          );
          errors.push(...translatedErrors);
        }
        
        // Continue with other variants even if one fails
        for (const variantId of group.variantIds) {
          variants.set(variantId, code);
        }
      } catch (error) {
        errors.push(this.wrapGenerationError(error, group));
      }
    }
    
    if (errors.length > 0) {
      return { success: false, errors, partialResults: variants };
    }
    
    return { success: true, variants };
  }
}
```

---

This error handling system is crucial for developer experience. Poor errors will make the compiler frustrating to use; great errors will make it a pleasure. Invest the time to get this right.
