// Injected by vite.config.ts `define`: short git hash (+ '-dirty') at build/serve
// time; 'unknown' outside a git checkout. Read by the export stamp.
declare const __GIT_HASH__: string;

// Type declarations for GLSL shader imports

declare module '*.glsl' {
    const content: string;
    export default content;
}

// Type declarations for CSS imports
declare module '*.css' {
    const content: string;
    export default content;
}

declare module '*.css?inline' {
    const content: string;
    export default content;
}

declare module '*.glsl?raw' {
    const content: string;
    export default content;
}

declare module '*.vert' {
    const content: string;
    export default content;
}

declare module '*.frag' {
    const content: string;
    export default content;
}
