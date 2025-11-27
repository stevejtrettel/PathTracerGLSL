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
