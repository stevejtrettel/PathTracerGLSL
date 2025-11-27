import { Container } from './Container.js';
import { Input } from '../inputs/Input.js';

export class Panel extends Container {
    constructor(title?: string) {
        super('div', 'cr-panel');

        if (title) {
            const header = document.createElement('div');
            header.className = 'cr-panel-header.js';
            header.textContent = title;
            this.domElement.appendChild(header);
        }
    }

    add(component: Container | Input): void {
        if (component instanceof Container) {
            component.mount(this);
        } else {
            component.mount(this.domElement);
        }
    }
}
