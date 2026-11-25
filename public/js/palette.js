export const STICKY_COLORS = [
  { name: 'yellow', label: 'Amarelo', hex: '#FFF27A' },
  { name: 'orange', label: 'Laranja', hex: '#FFC46B' },
  { name: 'pink', label: 'Rosa', hex: '#FFB3D1' },
  { name: 'purple', label: 'Roxo', hex: '#D7C2FF' },
  { name: 'blue', label: 'Azul', hex: '#A8D8FF' },
  { name: 'cyan', label: 'Ciano', hex: '#9EEBE3' },
  { name: 'green', label: 'Verde', hex: '#B6F0A8' },
  { name: 'lime', label: 'Lima', hex: '#E3F59A' },
  { name: 'gray', label: 'Cinza', hex: '#E3E5E8' },
  { name: 'white', label: 'Branco', hex: '#FFFFFF' },
];

export const stickyHex = (name) => (STICKY_COLORS.find((c) => c.name === name) || STICKY_COLORS[0]).hex;

/** Cores de traço/texto. */
export const INK_COLORS = ['#1F2328', '#5B6573', '#E5484D', '#F76B15', '#FFB224', '#30A46C', '#0090FF', '#5A4BFF', '#D6409F', '#FFFFFF'];

/** Preenchimento de formas e frames. */
export const FILL_COLORS = ['#FFFFFF', '#F1F3F5', '#FFF8DB', '#FFE9D6', '#FFE4EC', '#EFE7FF', '#E3F0FF', '#DDF7F3', '#E5F7DF', '#5A4BFF', '#1F2328', 'transparent'];

export const HIGHLIGHT_COLORS = ['#FFE14D', '#7CF29A', '#7CD4FF', '#FF9CC8', '#FFB36B'];

export const PEN_WIDTHS = [2, 4, 8, 14];

export const FONT_SIZES = [
  { label: 'P', size: 16 },
  { label: 'M', size: 24 },
  { label: 'G', size: 36 },
  { label: 'GG', size: 56 },
  { label: 'XG', size: 96 },
];
