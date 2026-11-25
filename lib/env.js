import fs from 'node:fs';
import path from 'node:path';

/**
 * Carrega variáveis de um arquivo .env na raiz (sem dependências).
 * Variáveis já definidas no ambiente têm prioridade.
 */
export function loadEnv(root) {
  const file = path.join(root, '.env');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
