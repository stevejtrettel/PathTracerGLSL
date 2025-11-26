// app/extensions/AppShortcutsExtension.ts

import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';

/**
 * AppShortcutsExtension - Application keyboard shortcuts
 *
 * Key bindings:
 *   1-9     : Switch renderers
 *   r/R     : Reset accumulation
 *   Space   : Toggle rendering (start/stop)
 *   \       : Pause/resume
 *   p/P     : Start production render (prompts for samples)
 *   Escape  : Stop rendering
 *   x       : Export PNG screenshot
 *   X       : Export HDR
 *   a/A     : Export all AOVs
 *   j/J     : Quick save session
 *   o/O     : Load session from file
 *   m/M     : Cycle display mode (for AOV renderers)
 *
 * Note: This is for application commands, separate from KeyboardControls
 * which handles 6DOF camera navigation.
 */
export class AppShortcutsExtension {
    name = 'app-shortcuts';
    version = '1.0.0';
    description = 'Application keyboard shortcuts';

    private app!: App;
    private boundHandler: ((e: KeyboardEvent) => void) | null = null;

    install(app: App, _bus: EventBus): void {
        this.app = app;

        this.boundHandler = this.handleKeyDown.bind(this);
        window.addEventListener('keydown', this.boundHandler);

        console.log('AppShortcuts installed:');
        console.log('  1-9     : Switch renderers');
        console.log('  r       : Reset accumulation');
        console.log('  Space   : Toggle rendering');
        console.log('  \\       : Pause/resume');
        console.log('  p       : Production render');
        console.log('  Escape  : Stop');
        console.log('  x/X     : Export PNG/HDR');
        console.log('  a       : Export AOVs');
        console.log('  j/o     : Save/load session');
        console.log('  m       : Cycle display mode');
    }

    uninstall(): void {
        if (this.boundHandler) {
            window.removeEventListener('keydown', this.boundHandler);
            this.boundHandler = null;
        }
    }

    private handleKeyDown(e: KeyboardEvent): void {
        // Skip keyboard shortcuts when user is typing in input fields
        const target = e.target as HTMLElement;
        const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
        if (isTyping) {
            return;
        }

        // Don't handle if locked in production (except escape)
        if (this.app.isLocked() && e.key !== 'Escape') {
            console.warn('Locked in production mode - press Escape to stop');
            return;
        }

        const rendererIds = this.app.getAvailableRendererIds();

        // 1-9: Switch renderers
        if (e.key >= '1' && e.key <= '9') {
            const index = parseInt(e.key) - 1;
            if (index < rendererIds.length) {
                this.app.selectRenderer(rendererIds[index]);
            }
            return;
        }

        switch (e.key) {
            // r/R: Reset accumulation
            case 'r':
            case 'R':
                this.app.clearAccumulation();
                break;

            // Space: Toggle rendering
            case ' ':
                e.preventDefault();
                if (this.app.isActive()) {
                    this.app.stop();
                } else {
                    this.app.start();
                }
                break;

            // \: Pause/resume
            case '\\':
                if (this.app.isPaused()) {
                    this.app.resume();
                } else {
                    this.app.pause();
                }
                break;

            // p/P: Production render
            case 'p':
            case 'P':
                e.preventDefault();
                this.startProductionRender();
                break;

            // Escape: Stop rendering
            case 'Escape':
                this.app.stop();
                break;

            // x: Export PNG screenshot
            case 'x':
                e.preventDefault();
                this.app.exportPNG();
                break;

            // X (shift+x): Export HDR
            case 'X':
                e.preventDefault();
                this.app.exportHDR();
                break;

            // a/A: Export all AOVs
            case 'a':
            case 'A':
                e.preventDefault();
                this.app.exportAllAOVs();
                break;

            // j/J: Quick save session
            case 'j':
            case 'J':
                e.preventDefault();
                this.app.quickSave();
                break;

            // o/O: Load session from file
            case 'o':
            case 'O':
                e.preventDefault();
                this.app.loadSessionFromFile();
                break;

            // m/M: Cycle display mode
            case 'm':
            case 'M':
                e.preventDefault();
                this.app.cycleDisplayMode();
                break;
        }
    }

    private startProductionRender(): void {
        const samplesStr = prompt('Target samples?', '1000');
        if (samplesStr) {
            const samples = parseInt(samplesStr);
            if (samples > 0) {
                this.app.renderProduction(samples).then(() => {
                    console.log('Production render complete!');
                }).catch(err => {
                    if (err.name === 'RenderStopped') {
                        console.log('Production render stopped');
                    } else {
                        console.error('Production render failed:', err);
                    }
                });
            }
        }
    }
}
