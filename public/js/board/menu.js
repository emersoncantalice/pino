/** Menu "⋯" do quadro: exportar, importar e atalhos. */
import { state, canEdit } from './state.js';
import { icon } from '../icons.js';
import { h } from '../util.js';
import { openPopover, closePopover, popoverOpenFor, menuContent } from '../popover.js';
import { openModal } from '../modal.js';
import { exportPNG, exportSVG, exportJSON } from './exporter.js';
import { importFiles, importImageFile } from './importer.js';
import { pickStructureFile } from './structures.js';
import { fitAll } from './input.js';

function pickFile(accept, onFile) {
  const input = h('input', { type: 'file', accept, hidden: true });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.remove();
    if (f) onFile(f);
  });
  document.body.appendChild(input);
  input.click();
}

export function initMenu(btn) {
  btn.innerHTML = icon('more', 20);
  btn.addEventListener('click', () => {
    if (popoverOpenFor(btn)) return closePopover();
    const sel = state.selection.size > 0;
    const edit = canEdit();
    openPopover(
      btn,
      menuContent(
        [
          { heading: 'Exportar' },
          { label: 'Imagem PNG — quadro inteiro', icon: 'download', onClick: () => exportPNG('all') },
          sel ? { label: 'Imagem PNG — só a seleção', icon: 'download', onClick: () => exportPNG('selection') } : null,
          { label: 'Vetor SVG — quadro inteiro', icon: 'download', onClick: () => exportSVG('all') },
          sel ? { label: 'Vetor SVG — só a seleção', icon: 'download', onClick: () => exportSVG('selection') } : null,
          { label: 'Backup do quadro (.json)', icon: 'file', onClick: exportJSON },
          edit ? 'sep' : null,
          edit ? { heading: 'Importar' } : null,
          edit ? { label: 'Estrutura (PNG ou SVG)', icon: 'structure', onClick: pickStructureFile } : null,
          edit ? { label: 'Imagem', icon: 'image', onClick: () => pickFile('image/*,.svg', (f) => importImageFile(f)) } : null,
          edit ? { label: 'Restaurar backup (.json)', icon: 'upload', onClick: () => pickFile('.json,application/json', (f) => importFiles([f])) } : null,
          'sep',
          { label: 'Ajustar à tela', icon: 'fit', onClick: fitAll },
          { label: 'Atalhos de teclado', icon: 'keyboard', onClick: openShortcuts },
          { label: 'Voltar para meus quadros', icon: 'chevronLeft', onClick: () => (location.href = '/') },
        ],
        icon,
      ),
      { placement: 'bottom', align: 'start' },
    );
  });
}

const SHORTCUTS = [
  ['Selecionar', ['V']],
  ['Mover o quadro', ['H'], 'ou segure Espaço / botão do meio'],
  ['Post-it', ['N'], 'ou duplo clique no vazio'],
  ['Texto', ['T']],
  ['Forma', ['S']],
  ['Área (frame)', ['F']],
  ['Desenhar', ['P']],
  ['Seta', ['L']],
  ['Borracha', ['E']],
  ['Editar texto do item', ['Enter'], 'ou duplo clique'],
  ['Desfazer / refazer', ['Ctrl', 'Z'], 'Ctrl+Shift+Z / Ctrl+Y'],
  ['Copiar / colar / recortar', ['Ctrl', 'C'], 'Ctrl+V / Ctrl+X'],
  ['Duplicar', ['Ctrl', 'D']],
  ['Selecionar tudo', ['Ctrl', 'A']],
  ['Excluir', ['Delete']],
  ['Mover seleção', ['←', '↑', '→', '↓'], 'Shift = 10px'],
  ['Zoom', ['Ctrl', '+'], 'roda do mouse / pinça'],
  ['Zoom 100%', ['Ctrl', '0']],
  ['Ajustar tudo à tela', ['Shift', '1']],
  ['Ajustar à seleção', ['Shift', '2']],
];

export function openShortcuts() {
  const grid = h('div', { class: 'kbd-grid' });
  for (const [label, keys, extra] of SHORTCUTS) {
    grid.append(
      h('span', {}, label, extra ? h('span', { class: 'hint', text: ` — ${extra}` }) : null),
      h('span', {}, keys.map((k) => h('kbd', { text: k }))),
    );
  }
  openModal({ title: 'Atalhos de teclado', body: grid, width: 560 });
}
