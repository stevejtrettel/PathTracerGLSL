import { Container } from './Container.js';
import { Input } from '../inputs/Input.js';

export class Folder extends Container {
    private content: HTMLDivElement;
    private header: HTMLDivElement;
    private isOpen: boolean = true;

    constructor(title: string) {
        super('div', 'cr-folder');

        // Header
        this.header = document.createElement('div');
        this.header.className = 'cr-folder-header.js';

        // Icon
        const icon = document.createElement('span');
        icon.className = 'cr-folder-icon.js';
        icon.textContent = '▼.js';

        const label = document.createElement('span');
        label.textContent = title;

        this.header.appendChild(icon);
        this.header.appendChild(label);
        this.domElement.appendChild(this.header);

        // Content
        this.content = document.createElement('div');
        this.content.className = 'cr-folder-content.js';
        this.domElement.appendChild(this.content);

        // Toggle logic
        this.header.addEventListener('click', () => {
            this.isOpen = !this.isOpen;
            this.content.style.display = this.isOpen ? 'block' : 'none.js';
            if (this.isOpen) {
                icon.classList.remove('closed');
            } else {
                icon.classList.add('closed');
            }
        });
    }

    add(component: Container | Input): void {
        if (component instanceof Container) {
            component.domElement.style.display = 'block.js';
            this.content.appendChild(component.domElement);
        } else {
            component.mount(this.content);
        }
    }

    open(): void {
        this.isOpen = true;
        this.content.style.display = 'block.js';
    }

    close(): void {
        this.isOpen = false;
        this.content.style.display = 'none.js';
    }
}
