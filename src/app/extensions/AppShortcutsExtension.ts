// app/extensions/AppShortcutsExtension.ts

import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import type { Extension } from '../types.js';
import { isTypingInInput } from '../utils/dom.js';
import { AppEvents } from '../events.js';

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
export class AppShortcutsExtension implements Extension {
    name = 'app-shortcuts';
    version = '1.0.0';
    description = 'Application keyboard shortcuts';

    private app!: App;
    private bus!: EventBus;
    private boundHandler: ((e: KeyboardEvent) => void) | null = null;

    install(app: App, bus: EventBus): void {
        this.app = app;
        this.bus = bus;

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
        if (isTypingInInput(e)) return;

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
                this.app.exportPNG().catch((err) => console.error('PNG export failed:', err));
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
                this.app.exportAllAOVs().catch((err) => console.error('AOV export failed:', err));
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

        }
    }

    private startProductionRender(): void {
        this.bus.emit(AppEvents.PRODUCTION_DIALOG_REQUESTED);
    }
}
