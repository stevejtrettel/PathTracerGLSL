// tools/devServer.mjs — the Vite dev server the browser tools (witness.mjs, shoot.mjs) drive.
//
// `ensure()` reuses a server already answering on the port, else spawns `npm run dev` from the
// repository root and kills it when the process exits (or on Ctrl-C). A tool run from one
// worktree on another worktree's port would therefore render that worktree's code: give each
// worktree its own port.

import { spawn } from 'node:child_process';

export function devServer(port) {
    const baseUrl = `http://localhost:${port}`;
    let child = null;

    const up = async () => {
        try {
            const res = await fetch(`${baseUrl}/lab.html`, { signal: AbortSignal.timeout(1500) });
            return res.ok;
        } catch {
            return false;
        }
    };

    const stop = () => {
        if (child && !child.killed) child.kill();
    };
    process.on('exit', stop);
    process.on('SIGINT', () => {
        stop();
        process.exit(130);
    });

    const ensure = async () => {
        if (await up()) return;
        process.stdout.write('starting dev server… ');
        child = spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
            cwd: new URL('..', import.meta.url).pathname,
            stdio: 'ignore',
            detached: false,
        });
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (await up()) {
                console.log('up.');
                return;
            }
        }
        throw new Error(`dev server did not come up on :${port} within 30s`);
    };

    return { baseUrl, ensure, stop };
}
