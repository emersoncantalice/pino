/**
 * Validação dos itens do quadro recebidos dos clientes.
 * Só campos conhecidos e com tipos corretos são aceitos.
 */
const TYPES = new Set(['sticky', 'text', 'shape', 'frame', 'image', 'path']);
const SHAPES = new Set(['rect', 'round', 'ellipse', 'diamond', 'triangle']);
const ALIGNS = new Set(['left', 'center', 'right']);
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|transparent)$/;

const num = (min, max) => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const text = (max) => (v) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const color = (v) => (typeof v === 'string' && COLOR_RE.test(v) ? v : undefined);
const oneOf = (set) => (v) => (set.has(v) ? v : undefined);

const FIELDS = {
  x: num(-1e7, 1e7),
  y: num(-1e7, 1e7),
  w: num(1, 1e6),
  h: num(1, 1e6),
  z: num(-1e9, 1e9),
  locked: bool,
  text: text(10000),
  title: text(300),
  name: text(300),
  color,
  fill: color,
  stroke: color,
  textColor: color,
  fontSize: num(4, 1000),
  shape: oneOf(SHAPES),
  align: oneOf(ALIGNS),
  bold: bool,
  structure: bool,
  arrow: bool,
  assetId: (v) => (typeof v === 'string' && ID_RE.test(v) ? v : undefined),
  points: (v) => {
    if (!Array.isArray(v) || v.length > 40000 || v.length % 2 !== 0) return undefined;
    for (const n of v) if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
    return v.map((n) => Math.round(n * 100) / 100);
  },
  width: num(0.5, 200),
  opacity: num(0.05, 1),
  vw: num(0.01, 1e7),
  vh: num(0.01, 1e7),
};

const REQUIRED = new Set(['x', 'y', 'w', 'h', 'z']);
const KEYS = Object.keys(FIELDS);

export function sanitizeItem(raw, user) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id) || !TYPES.has(raw.type)) return null;
  const item = { id: raw.id, type: raw.type, x: 0, y: 0, w: 100, h: 100, z: 0 };
  for (const k of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    const v = FIELDS[k](raw[k]);
    if (v !== undefined) item[k] = v;
  }
  if (user) {
    item.createdBy = user.id;
    item.author = user.name;
  } else {
    if (typeof raw.createdBy === 'string') item.createdBy = raw.createdBy.slice(0, 64);
    if (typeof raw.author === 'string') item.author = raw.author.slice(0, 100);
  }
  return item;
}

/** Retorna um patch limpo. `null` significa "remover o campo". */
export function sanitizePatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const patch = {};
  for (const k of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    const value = raw[k];
    if (value === null) {
      if (!REQUIRED.has(k)) patch[k] = null;
      continue;
    }
    const v = FIELDS[k](value);
    if (v !== undefined) patch[k] = v;
  }
  return Object.keys(patch).length ? patch : null;
}

export function applyPatch(item, patch) {
  for (const k of Object.keys(patch)) {
    if (patch[k] === null) delete item[k];
    else item[k] = patch[k];
  }
}
