# Experiment Extension Contract

Experiment extensions add research workflow capabilities like parameter sweeps, A/B comparisons, and convergence studies.

## Extended Interface

```typescript
interface ExperimentExtension extends Extension {
  // Parameter sweeps
  sweep(config: SweepConfig): Promise<SweepResult[]>;
  
  // A/B comparisons
  compare(configs: CompareConfig[]): Promise<ComparisonResult>;
  
  // Convergence analysis
  analyzeConvergence(config: ConvergenceConfig): Promise<ConvergenceResult>;
  
  // Experiment management
  listExperiments(): ExperimentRecord[];
  loadExperiment(id: string): Promise<ExperimentRecord>;
  cancelExperiment(): void;
}
```

## Sweep Configuration

```typescript
interface SweepConfig {
  parameter: string | string[];       // Parameter path(s) to vary
  values: any[] | any[][];           // Values to test
  samplesPerValue: number;            // Samples before moving to next
  
  // Optional
  baseline?: any;                    // Reference value for comparison
  randomOrder?: boolean;             // Randomize value order
  saveImages?: boolean;              // Save image for each value
  metrics?: MetricType[];            // What to measure
}

interface SweepResult {
  value: any;
  image?: string;                    // Path or data URL
  metrics: {
    samples: number;
    time: number;
    variance?: number;
    customMetrics?: Record<string, number>;
  };
}

type MetricType = 'variance' | 'time' | 'memory' | 'custom';
```

## Comparison Configuration

```typescript
interface CompareConfig {
  name: string;                      // Configuration name
  recipe: Recipe;                    // Complete recipe
  samples: number;                   // Samples to accumulate
  
  // Optional
  tileConfig?: TileConfig;          // For tiled comparison
  metrics?: MetricType[];           // Metrics to track
}

interface ComparisonResult {
  configs: CompareConfig[];
  results: Array<{
    name: string;
    image: string;
    metrics: Record<string, number>;
    recipe: Recipe;
  }>;
  analysis?: {
    fastest: string;
    lowestVariance: string;
    recommendations: string[];
  };
}
```

## Implementation Examples

### Basic Parameter Sweep
```typescript
class ParameterSweepExtension implements ExperimentExtension {
  name = 'experiment-sweep';
  dependencies = ['ui'];  // Needs UI for progress display and controls
  async sweep(config: SweepConfig): Promise<SweepResult[]> {
    const results: SweepResult[] = [];
    const original = this.app.parameterStore.get(config.parameter);
    
    for (const value of config.values) {
      // Set parameter
      this.app.parameterStore.set(config.parameter, value);
      
      // Reset and render
      this.app.renderCoordinator.resetAccumulation();
      const startTime = performance.now();
      
      // Accumulate samples
      await this.renderSamples(config.samplesPerValue);
      
      // Capture result
      const result: SweepResult = {
        value,
        metrics: {
          samples: config.samplesPerValue,
          time: performance.now() - startTime,
          variance: this.computeVariance()
        }
      };
      
      // Save image if requested
      if (config.saveImages) {
        result.image = await this.app.captureImage();
      }
      
      results.push(result);
      
      // Emit progress
      this.bus.emit('experiment.progress', {
        current: results.length,
        total: config.values.length,
        parameter: config.parameter,
        value
      });
    }
    
    // Restore original
    this.app.parameterStore.set(config.parameter, original);
    
    return results;
  }
}
```

### Multi-Parameter Grid Search
```typescript
class GridSearchExtension implements ExperimentExtension {
    name = 'grid-search';
    dependencies = ['ui', 'export'];  // Needs UI for controls, export for saving results
  async gridSearch(params: GridSearchConfig): Promise<GridResult> {
    const combinations = this.generateCombinations(params);
    const results = [];
    
    for (const combo of combinations) {
      // Set all parameters
      this.app.parameterStore.batch(combo);
      
      // Render and measure
      await this.renderSamples(params.samplesPerCombination);
      
      results.push({
        parameters: combo,
        image: await this.app.captureImage(),
        metrics: this.collectMetrics()
      });
    }
    
    // Find optimal combination
    const optimal = this.findOptimal(results, params.optimizeFor);
    
    return { results, optimal };
  }
  
  private generateCombinations(params: GridSearchConfig) {
    // Cartesian product of all parameter values
    const keys = Object.keys(params.parameters);
    const values = keys.map(k => params.parameters[k]);
    
    return cartesianProduct(...values).map(combo => {
      return Object.fromEntries(
        keys.map((key, i) => [key, combo[i]])
      );
    });
  }
}
```

### Convergence Analysis
```typescript
class ConvergenceExtension implements ExperimentExtension {
  async analyzeConvergence(config: ConvergenceConfig): Promise<ConvergenceResult> {
    const measurements = [];
    const checkpoints = [1, 10, 50, 100, 500, 1000, 5000];
    
    this.app.renderCoordinator.resetAccumulation();
    
    for (const checkpoint of checkpoints) {
      // Render to checkpoint
      await this.renderToSample(checkpoint);
      
      // Measure convergence metrics
      const measurement = {
        samples: checkpoint,
        variance: this.computeVariance(),
        rmse: this.computeRMSE(),
        time: this.getElapsedTime()
      };
      
      measurements.push(measurement);
      
      // Check if converged
      if (measurement.variance < config.threshold) {
        break;
      }
    }
    
    return {
      measurements,
      converged: measurements[measurements.length - 1].variance < config.threshold,
      optimalSamples: this.findOptimalSampleCount(measurements)
    };
  }
}
```

## Experiment Records

```typescript
interface ExperimentRecord {
  id: string;
  type: 'sweep' | 'comparison' | 'convergence' | 'grid';
  timestamp: Date;
  config: any;                       // Original configuration
  results: any;                      // Type-specific results
  
  // Metadata
  duration: number;                  // Total time in ms
  recipeName?: string;              // Base recipe used
  notes?: string;                   // User annotations
}
```

## Progress Reporting

```typescript
// Experiment progress events
bus.emit('experiment.started', {
  id: string,
  type: string,
  totalSteps: number
});

bus.emit('experiment.progress', {
  id: string,
  currentStep: number,
  totalSteps: number,
  currentValue?: any,
  timeElapsed: number,
  timeRemaining?: number  // Estimated
});

bus.emit('experiment.completed', {
  id: string,
  results: any
});

bus.emit('experiment.cancelled', {
  id: string,
  reason?: string
});
```

## Analysis Tools

```typescript
interface ExperimentAnalysis {
  // Statistical analysis
  computeStatistics(results: SweepResult[]): {
    mean: number;
    stddev: number;
    min: number;
    max: number;
    correlation?: number;
  };
  
  // Find optimal parameters
  findOptimal(results: any[], metric: string): {
    value: any;
    score: number;
    confidence: number;
  };
  
  // Generate report
  generateReport(record: ExperimentRecord): {
    summary: string;
    charts: Chart[];
    recommendations: string[];
    data: any;
  };
}
```

## Visualization

Experiments can generate visualizations:

```typescript
class ExperimentVisualization {
  // Sweep line chart
  createSweepChart(results: SweepResult[]): Chart {
    return {
      type: 'line',
      data: {
        labels: results.map(r => String(r.value)),
        datasets: [{
          label: 'Variance',
          data: results.map(r => r.metrics.variance)
        }]
      }
    };
  }
  
  // Comparison grid
  createComparisonGrid(results: ComparisonResult): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'comparison-grid';
    
    for (const result of results.results) {
      const cell = this.createComparisonCell(result);
      grid.appendChild(cell);
    }
    
    return grid;
  }
  
  // Convergence plot
  createConvergencePlot(result: ConvergenceResult): Chart {
    return {
      type: 'logarithmic',
      data: {
        x: result.measurements.map(m => m.samples),
        y: result.measurements.map(m => m.variance)
      }
    };
  }
}
```

## Batch Processing

For multiple experiments:

```typescript
interface BatchConfig {
  experiments: Array<{
    type: 'sweep' | 'comparison';
    config: any;
  }>;
  parallel?: boolean;              // Run simultaneously if possible
  continueOnError?: boolean;       // Don't stop if one fails
}

class BatchExperimentExtension {
  async runBatch(config: BatchConfig): Promise<BatchResult[]> {
    const results = [];
    
    for (const exp of config.experiments) {
      try {
        const result = await this.runExperiment(exp);
        results.push({ success: true, result });
      } catch (error) {
        if (!config.continueOnError) throw error;
        results.push({ success: false, error });
      }
    }
    
    return results;
  }
}
```

## Best Practices

1. **Save intermediate results** - Don't lose hours of work to crashes
2. **Estimate completion time** - Help users plan long experiments
3. **Allow cancellation** - Provide clean abort mechanism
4. **Generate reports** - Automatic summaries and visualizations
5. **Track metadata** - Record everything needed to reproduce
6. **Validate before starting** - Check parameter ranges, recipe validity
