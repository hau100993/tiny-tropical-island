import './ui/styles.css';
import { App } from './core/App';
import { vi } from './ui/strings.vi';

function showFatal(message: string): void {
  const div = document.createElement('div');
  div.className = 'fatal-message';
  div.textContent = message;
  document.body.append(div);
}

function hasWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

const container = document.getElementById('app');
if (!container) throw new Error('#app element missing from index.html');

if (!hasWebGL2()) {
  showFatal(vi.noWebGL2);
} else {
  new App(container).start();
}
