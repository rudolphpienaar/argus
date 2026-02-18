/**
 * @file Workspace Launch Controls
 *
 * Command-pill rendering for workspace federation launch action.
 *
 * @module core/stages/gather/workspace/internal/launch
 */

/**
 * Add workspace launch command pill into project metadata zone.
 */
export function workspaceFederalizeButton_render(): void {
    const metaEl: Element | null = document.querySelector('.project-meta');
    if (!metaEl) {
        return;
    }

    workspaceFederalizeButton_remove();

    const launchButton: HTMLButtonElement = document.createElement('button');
    launchButton.id = 'workspace-federalize-btn';
    launchButton.className = 'pill-btn install-pill';
    launchButton.style.cssText = 'margin-top: 1.5rem; width: 100%; max-width: 400px; height: 50px; font-size: 1rem;';
    launchButton.innerHTML = '<span class="btn-text">FEDERALIZE AND LAUNCH</span>';
    launchButton.addEventListener('click', (): void => {
        void workspaceTraining_launch();
    });

    metaEl.appendChild(launchButton);
}

/**
 * Remove workspace launch command pill.
 */
export function workspaceFederalizeButton_remove(): void {
    const launchButton: HTMLElement | null = document.getElementById('workspace-federalize-btn');
    if (launchButton) {
        launchButton.remove();
    }
}

/**
 * Launch process-stage federation flow without static import cycles.
 */
async function workspaceTraining_launch(): Promise<void> {
    const processModule: { training_launch: () => void } = await import('../../../process.js');
    processModule.training_launch();
}
