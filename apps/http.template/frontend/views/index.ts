/** DON'T USE BARREL IMPORT/EXPORT IN FRONTEND CODE **/
import { icon, infoIcon } from '@components/icon/index.ts';
import { themeToggle } from '@components/theme-toggle/index.ts';

function mount(): void {
    const root = document.getElementById('app');
    if (!root) return;

    root.append(themeToggle(), icon({ image: infoIcon, ariaLabel: 'About', title: 'MCP Aggregator' }));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
} else {
    mount();
}
