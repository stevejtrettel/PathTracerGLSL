// Resolve Vite-style `?raw` imports to a module exporting the file text.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('?url')) { const r = await next(specifier.slice(0, -4), context); return { url: r.url + '?url', shortCircuit: true, format: 'module' }; }
  if (specifier.endsWith('?raw')) {
    const r = await next(specifier.slice(0, -4), context);
    return { url: r.url + '?raw', shortCircuit: true, format: 'module' };
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.endsWith('?url')) return { format: 'module', source: `export default ${JSON.stringify(url)};`, shortCircuit: true };
  if (url.endsWith('?raw')) {
    const text = await readFile(fileURLToPath(url.slice(0, -4)), 'utf8');
    return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  }
  return next(url, context);
}
