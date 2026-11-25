/**
 * Estruturas prontas (modelos). Módulo compartilhado entre o navegador e o servidor:
 * não usa DOM nem APIs globais — o gerador de IDs é passado como parâmetro.
 *
 * Cada modelo gera itens posicionados ao redor da origem (0, 0).
 */

const C = {
  yellow: '#FFF27A',
  orange: '#FFC46B',
  pink: '#FFB3D1',
  purple: '#D7C2FF',
  blue: '#A8D8FF',
  green: '#B6F0A8',
  white: '#FFFFFF',
};

const FILL = {
  white: '#FFFFFF',
  cream: '#FFF8DB',
  peach: '#FFE9D6',
  rose: '#FFE4EC',
  lilac: '#EFE7FF',
  sky: '#E3F0FF',
  mint: '#DDF7F3',
  green: '#E5F7DF',
  gray: '#F1F3F5',
};

function factory(makeId) {
  let z = 0;
  return {
    frame: (x, y, w, h, title, fill = FILL.white) => ({ id: makeId(), type: 'frame', x, y, w, h, z: -100 + z++, title, fill }),
    text: (x, y, w, text, fontSize = 32, extra = {}) => ({
      id: makeId(), type: 'text', x, y, w, h: Math.round(fontSize * 1.65), z: 10 + z++, text, fontSize, color: '#1F2328', ...extra,
    }),
    sticky: (x, y, text, color = C.yellow) => ({ id: makeId(), type: 'sticky', x, y, w: 200, h: 200, z: 20 + z++, text, color }),
    shape: (x, y, w, h, shape, text, fill, stroke, extra = {}) => ({
      id: makeId(), type: 'shape', x, y, w, h, z: 15 + z++, shape, text, fill, stroke, fontSize: 28, ...extra,
    }),
  };
}

function columns(f, titles, { w, h, gap, title, fills }) {
  const total = titles.length * w + (titles.length - 1) * gap;
  const x0 = -Math.round(total / 2);
  const y0 = -Math.round(h / 2);
  const items = [];
  if (title) items.push(f.text(x0, y0 - 110, Math.min(total, 1000), title, 56, { bold: true }));
  titles.forEach((t, i) => items.push(f.frame(x0 + i * (w + gap), y0, w, h, t, fills[i % fills.length])));
  return { items, x0, y0 };
}

export const TEMPLATES = [
  {
    id: 'kanban',
    name: 'Kanban',
    description: 'Colunas A fazer, Em andamento e Concluído.',
    build(makeId) {
      const f = factory(makeId);
      const { items, x0, y0 } = columns(f, ['A fazer', 'Em andamento', 'Concluído'], {
        w: 560, h: 900, gap: 40, title: 'Kanban', fills: [FILL.cream, FILL.sky, FILL.green],
      });
      items.push(f.sticky(x0 + 40, y0 + 90, 'Arraste os post-its entre as colunas', C.yellow));
      items.push(f.sticky(x0 + 300, y0 + 90, 'Clique duas vezes para editar', C.yellow));
      return items;
    },
  },
  {
    id: 'retro',
    name: 'Retrospectiva',
    description: 'O que foi bem, o que pode melhorar e ações.',
    build(makeId) {
      const f = factory(makeId);
      return columns(f, ['😀 O que foi bem', '🤔 O que pode melhorar', '🚀 Ações'], {
        w: 560, h: 900, gap: 40, title: 'Retrospectiva', fills: [FILL.green, FILL.peach, FILL.sky],
      }).items;
    },
  },
  {
    id: 'swot',
    name: 'Matriz SWOT',
    description: 'Forças, fraquezas, oportunidades e ameaças.',
    build(makeId) {
      const f = factory(makeId);
      const w = 640, h = 520, g = 30;
      const x0 = -w - g / 2, y0 = -h - g / 2;
      return [
        f.text(x0, y0 - 110, 900, 'Análise SWOT', 56, { bold: true }),
        f.frame(x0, y0, w, h, '💪 Forças', FILL.green),
        f.frame(x0 + w + g, y0, w, h, '⚠️ Fraquezas', FILL.rose),
        f.frame(x0, y0 + h + g, w, h, '🌱 Oportunidades', FILL.sky),
        f.frame(x0 + w + g, y0 + h + g, w, h, '⛈️ Ameaças', FILL.cream),
      ];
    },
  },
  {
    id: 'priorizacao',
    name: 'Impacto × Esforço',
    description: 'Matriz 2×2 para priorizar ideias.',
    build(makeId) {
      const f = factory(makeId);
      const w = 600, h = 480, g = 24;
      const x0 = -w - g / 2, y0 = -h - g / 2;
      return [
        f.text(x0, y0 - 120, 1000, 'Matriz Impacto × Esforço', 56, { bold: true }),
        f.text(x0 - 230, y0 + h - 30, 200, '↑ Impacto', 32, { align: 'right', bold: true }),
        f.text(x0 + w * 2 + g - 300, y0 + h * 2 + g + 20, 300, 'Esforço →', 32, { align: 'right', bold: true }),
        f.frame(x0, y0, w, h, '⚡ Vitórias rápidas — alto impacto, pouco esforço', FILL.green),
        f.frame(x0 + w + g, y0, w, h, '🏗️ Grandes projetos — alto impacto, muito esforço', FILL.sky),
        f.frame(x0, y0 + h + g, w, h, '🧩 Tarefas menores — pouco impacto, pouco esforço', FILL.cream),
        f.frame(x0 + w + g, y0 + h + g, w, h, '🚫 Evitar — pouco impacto, muito esforço', FILL.rose),
      ];
    },
  },
  {
    id: 'bmc',
    name: 'Business Model Canvas',
    description: 'Os 9 blocos do modelo de negócios.',
    build(makeId) {
      const f = factory(makeId);
      const cw = 340, g = 16, top = 760, bottom = 340;
      const total = cw * 5 + g * 4;
      const x0 = -Math.round(total / 2), y0 = -Math.round((top + g + bottom) / 2);
      const half = (top - g) / 2;
      const col = (i) => x0 + i * (cw + g);
      const bw = (total - g) / 2;
      return [
        f.text(x0, y0 - 110, 1200, 'Business Model Canvas', 56, { bold: true }),
        f.frame(col(0), y0, cw, top, '🤝 Parcerias-chave'),
        f.frame(col(1), y0, cw, half, '⚙️ Atividades-chave'),
        f.frame(col(1), y0 + half + g, cw, half, '🧱 Recursos-chave'),
        f.frame(col(2), y0, cw, top, '🎁 Proposta de valor', FILL.cream),
        f.frame(col(3), y0, cw, half, '💬 Relacionamento'),
        f.frame(col(3), y0 + half + g, cw, half, '🚚 Canais'),
        f.frame(col(4), y0, cw, top, '👥 Segmentos de clientes'),
        f.frame(x0, y0 + top + g, bw, bottom, '💸 Estrutura de custos', FILL.gray),
        f.frame(x0 + bw + g, y0 + top + g, bw, bottom, '💰 Fontes de receita', FILL.gray),
      ];
    },
  },
  {
    id: 'empatia',
    name: 'Mapa de empatia',
    description: 'Pensa, escuta, vê, fala — dores e ganhos.',
    build(makeId) {
      const f = factory(makeId);
      const w = 560, h = 420, g = 20;
      const x0 = -w - g / 2, y0 = -h - g / 2 - 160;
      const bottomY = y0 + 2 * h + 2 * g;
      const bw = w;
      return [
        f.text(x0, y0 - 110, 900, 'Mapa de empatia', 56, { bold: true }),
        f.frame(x0, y0, w, h, '💭 O que pensa e sente?', FILL.lilac),
        f.frame(x0 + w + g, y0, w, h, '👂 O que escuta?', FILL.sky),
        f.frame(x0, y0 + h + g, w, h, '👀 O que vê?', FILL.mint),
        f.frame(x0 + w + g, y0 + h + g, w, h, '🗣️ O que fala e faz?', FILL.cream),
        f.frame(x0, bottomY, bw, 300, '😣 Dores', FILL.rose),
        f.frame(x0 + w + g, bottomY, bw, 300, '🎉 Ganhos', FILL.green),
        f.shape(-130, y0 + h + g / 2 - 130, 260, 260, 'ellipse', 'Persona', '#FFFFFF', '#6E56CF', { fontSize: 32 }),
      ];
    },
  },
  {
    id: 'roadmap',
    name: 'Roadmap',
    description: 'Planejamento por trimestre.',
    build(makeId) {
      const f = factory(makeId);
      return columns(f, ['1º trimestre', '2º trimestre', '3º trimestre', '4º trimestre'], {
        w: 440, h: 760, gap: 24, title: 'Roadmap', fills: [FILL.sky, FILL.lilac, FILL.mint, FILL.cream],
      }).items;
    },
  },
  {
    id: '5w2h',
    name: '5W2H',
    description: 'O quê, por quê, onde, quando, quem, como e quanto.',
    build(makeId) {
      const f = factory(makeId);
      return columns(
        f,
        ['O quê?', 'Por quê?', 'Onde?', 'Quando?', 'Quem?', 'Como?', 'Quanto?'],
        { w: 300, h: 760, gap: 16, title: 'Plano de ação 5W2H', fills: [FILL.cream, FILL.peach, FILL.rose, FILL.lilac, FILL.sky, FILL.mint, FILL.green] },
      ).items;
    },
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'Tema central com espaço para ideias.',
    build(makeId) {
      const f = factory(makeId);
      return [
        f.frame(-800, -500, 1600, 1000, '💡 Brainstorm', FILL.white),
        f.shape(-180, -100, 360, 200, 'ellipse', 'Qual é o tema?', FILL.lilac, '#6E56CF', { fontSize: 34 }),
        f.sticky(-700, -400, 'Uma ideia por post-it', C.blue),
        f.sticky(500, -400, 'Quantidade antes de qualidade', C.pink),
        f.sticky(-700, 200, 'Construa sobre as ideias dos outros', C.green),
      ];
    },
  },
];

/** Gera os itens de um modelo com IDs novos. */
export function buildTemplate(id, makeId) {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? t.build(makeId) : [];
}
