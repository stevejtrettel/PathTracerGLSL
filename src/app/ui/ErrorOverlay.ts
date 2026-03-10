// app/ui/ErrorOverlay.ts
// Full-screen error overlay for compilation failures

import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import type { Diagnostic } from '../../errors/core/Diagnostic.js';

/**
 * ErrorOverlay — full-screen overlay that displays compilation errors.
 *
 * Created by App on construction, hidden by default.
 * When compilation fails, App calls show(bag) to display formatted diagnostics.
 * User dismisses via close button, backdrop click, or Escape key.
 */
export class ErrorOverlay {
    private root: HTMLDivElement;
    private body: HTMLDivElement;
    private onKeyDown: (e: KeyboardEvent) => void;

    constructor(parent: HTMLElement) {
        this.root = document.createElement('div');
        this.root.className = 'error-overlay';
        Object.assign(this.root.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '1100',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--ui-font-family, system-ui, sans-serif)',
        });

        // Backdrop
        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, {
            position: 'absolute',
            inset: '0',
            background: 'rgba(0, 0, 0, 0.85)',
        });
        backdrop.addEventListener('click', () => this.hide());
        this.root.appendChild(backdrop);

        // Panel
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            position: 'relative',
            maxWidth: '720px',
            maxHeight: '80vh',
            width: '90%',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--ui-bg-primary, rgba(30, 30, 30, 0.98))',
            border: '1px solid var(--ui-border, rgba(255,255,255,0.1))',
            borderRadius: 'var(--ui-radius-xl, 12px)',
            boxShadow: 'var(--ui-shadow-lg, 0 8px 32px rgba(0,0,0,0.5))',
            color: 'var(--ui-text-primary, rgba(255,255,255,0.95))',
        });
        this.root.appendChild(panel);

        // Header
        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--ui-border, rgba(255,255,255,0.1))',
        });

        const title = document.createElement('div');
        Object.assign(title.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: 'var(--ui-font-size-lg, 15px)',
            fontWeight: 'var(--ui-font-weight-bold, 600)',
        });
        title.innerHTML = `<span style="color:var(--ui-danger, #f44336);">&#9679;</span> Compilation Error`;

        const closeBtn = document.createElement('button');
        Object.assign(closeBtn.style, {
            background: 'none',
            border: 'none',
            color: 'var(--ui-text-secondary, rgba(255,255,255,0.7))',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '4px 8px',
            borderRadius: 'var(--ui-radius-sm, 4px)',
        });
        closeBtn.textContent = '\u2715';
        closeBtn.addEventListener('click', () => this.hide());
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = 'var(--ui-text-primary, #fff)');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = 'var(--ui-text-secondary, rgba(255,255,255,0.7))');

        header.appendChild(title);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // Body (scrollable)
        this.body = document.createElement('div');
        Object.assign(this.body.style, {
            flex: '1',
            overflowY: 'auto',
            padding: '16px 20px',
        });
        panel.appendChild(this.body);

        // Footer
        const footer = document.createElement('div');
        Object.assign(footer.style, {
            padding: '12px 20px',
            borderTop: '1px solid var(--ui-border, rgba(255,255,255,0.1))',
            display: 'flex',
            justifyContent: 'flex-end',
        });

        const dismissBtn = document.createElement('button');
        Object.assign(dismissBtn.style, {
            background: 'var(--ui-bg-tertiary, rgba(60,60,60,0.92))',
            border: '1px solid var(--ui-border, rgba(255,255,255,0.1))',
            color: 'var(--ui-text-primary, rgba(255,255,255,0.95))',
            padding: '6px 16px',
            borderRadius: 'var(--ui-radius-md, 6px)',
            cursor: 'pointer',
            fontSize: 'var(--ui-font-size-md, 13px)',
        });
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', () => this.hide());
        dismissBtn.addEventListener('mouseenter', () => dismissBtn.style.background = 'var(--ui-bg-hover, rgba(75,75,75,0.95))');
        dismissBtn.addEventListener('mouseleave', () => dismissBtn.style.background = 'var(--ui-bg-tertiary, rgba(60,60,60,0.92))');
        footer.appendChild(dismissBtn);
        panel.appendChild(footer);

        // Escape key
        this.onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.hide();
        };

        parent.appendChild(this.root);
    }

    show(bag: DiagnosticBag): void {
        this.body.innerHTML = this.formatBag(bag);
        this.root.style.display = 'flex';
        document.addEventListener('keydown', this.onKeyDown);
    }

    hide(): void {
        this.root.style.display = 'none';
        document.removeEventListener('keydown', this.onKeyDown);
    }

    dispose(): void {
        this.hide();
        this.root.remove();
    }

    // ========================================================================
    // HTML Diagnostic Formatting
    // ========================================================================

    private formatBag(bag: DiagnosticBag): string {
        const sorted = bag.getSorted();
        const parts = sorted.map(d => this.formatDiagnostic(d));
        parts.push(this.formatSummary(bag));
        return parts.join('');
    }

    private formatDiagnostic(d: Diagnostic): string {
        const isError = d.severity === 'error';
        const badgeColor = isError
            ? 'var(--ui-danger, #f44336)'
            : 'var(--ui-warning, #ffc107)';
        const label = d.severity.toUpperCase();

        let html = `<div style="margin-bottom:16px; padding:12px; background:rgba(255,255,255,0.03); border-radius:var(--ui-radius-md, 6px); border-left:3px solid ${badgeColor};">`;

        // Badge + message
        html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">`;
        html += `<span style="background:${badgeColor}; color:#fff; font-size:10px; font-weight:600; padding:2px 6px; border-radius:3px; letter-spacing:0.5px;">${label}</span>`;
        html += `<span style="font-size:var(--ui-font-size-md, 13px);">${escapeHtml(d.message)}</span>`;
        html += `</div>`;

        // Location
        if (d.location) {
            const loc = d.location;
            const orig = loc.originalLocation;

            // Extract original line number from path (e.g. ["line:18"] → 18)
            let originalLine: number | undefined;
            if (orig?.path?.length) {
                const lineEntry = orig.path.find(p => p.startsWith('line:'));
                if (lineEntry) originalLine = parseInt(lineEntry.slice(5), 10);
            }

            // Show original file + line prominently when available, else fall back to assembled
            const displayFile = orig?.source ?? loc.file ?? '';
            const displayLine = originalLine ?? loc.line;
            if (displayFile) {
                let locStr = displayFile;
                if (displayLine) locStr += `:${displayLine}`;
                html += `<div style="font-size:var(--ui-font-size-sm, 12px); color:var(--ui-text-secondary, rgba(255,255,255,0.7)); margin-bottom:8px; font-family:var(--ui-font-mono, monospace);">${escapeHtml(locStr)}</div>`;
            }

            // Source snippet — offset line numbers to show original file lines
            if (loc.sourceText) {
                const lineOffset = (originalLine && loc.line) ? originalLine - loc.line : 0;
                html += this.formatSourceSnippet(loc.sourceText, loc.line, loc.column, lineOffset);
            }
        }

        // Suggestions
        if (d.suggestions?.length) {
            for (const s of d.suggestions) {
                html += `<div style="font-size:var(--ui-font-size-sm, 11px); color:var(--ui-accent, #4a9eff); margin-top:6px;">${escapeHtml(s.message)}</div>`;
            }
        }

        html += `</div>`;
        return html;
    }

    private formatSourceSnippet(sourceText: string, errorLine: number, errorCol?: number, lineOffset: number = 0): string {
        const lines = sourceText.split('\n');
        const contextRadius = 2;
        const startLine = Math.max(1, errorLine - contextRadius);
        const endLine = Math.min(lines.length, errorLine + contextRadius);
        // Display line numbers offset to match original file
        const displayEnd = endLine + lineOffset;
        const gutterWidth = String(Math.max(displayEnd, 1)).length;

        let html = `<pre style="margin:8px 0 0; padding:8px 12px; background:rgba(0,0,0,0.3); border-radius:var(--ui-radius-sm, 4px); font-family:var(--ui-font-mono, monospace); font-size:var(--ui-font-size-sm, 11px); line-height:1.6; overflow-x:auto;">`;

        for (let i = startLine; i <= endLine; i++) {
            const line = lines[i - 1] ?? '';
            const displayNum = i + lineOffset;
            const lineNum = String(displayNum).padStart(gutterWidth);
            const isErrorLine = i === errorLine;

            if (isErrorLine) {
                html += `<span style="color:var(--ui-danger, #f44336); font-weight:600;">`;
                html += `  &gt; ${lineNum} | ${escapeHtml(line)}`;
                html += `</span>\n`;

                // Pointer line
                if (errorCol && errorCol > 0) {
                    const padding = ' '.repeat(gutterWidth + 5 + errorCol - 1);
                    // Guess token length
                    const rest = line.slice(errorCol - 1);
                    const tokenMatch = rest.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
                    const pLen = tokenMatch ? tokenMatch[0].length : 1;
                    html += `<span style="color:var(--ui-danger, #f44336);">${padding}${'^'.repeat(pLen)}</span>\n`;
                }
            } else {
                html += `<span style="color:var(--ui-text-muted, rgba(255,255,255,0.5));">`;
                html += `    ${lineNum} | ${escapeHtml(line)}`;
                html += `</span>\n`;
            }
        }

        html += `</pre>`;
        return html;
    }

    private formatSummary(bag: DiagnosticBag): string {
        const parts: string[] = [];
        const ec = bag.count('error');
        const wc = bag.count('warning');
        if (ec > 0) parts.push(`<span style="color:var(--ui-danger, #f44336);">${ec} error${ec !== 1 ? 's' : ''}</span>`);
        if (wc > 0) parts.push(`<span style="color:var(--ui-warning, #ffc107);">${wc} warning${wc !== 1 ? 's' : ''}</span>`);
        if (parts.length === 0) return '';
        return `<div style="margin-top:8px; font-size:var(--ui-font-size-md, 13px); color:var(--ui-text-secondary, rgba(255,255,255,0.7));">${parts.join(', ')}</div>`;
    }
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
