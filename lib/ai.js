/**
 * Agente "Foto → Post-its": envia a foto para o Google Gemini (visão)
 * e recebe as notas transcritas em JSON estruturado.
 *
 * Usa apenas `node:https` (sem SDK, sem dependências; funciona no Node 17).
 * Configure no arquivo .env:
 *   GEMINI_API_KEY=...            (chave do Google AI Studio)
 *   GEMINI_MODEL=gemini-4-carbon  (opcional; padrão abaixo)
 */
import https from 'node:https';

const API_HOST = 'generativelanguage.googleapis.com';
const INTERACTIONS_PATH = '/v1beta/interactions';
const API_REVISION = '2026-05-20';
// Gemini 4 Carbon: o modelo do Google com maior precisão multimodal (bom para letra à mão).
// Alternativa mais rápida e barata: gemini-4-hydrogen.
const DEFAULT_MODEL = 'gemini-4-carbon';

export const NOTE_COLORS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'cyan', 'green', 'lime', 'gray', 'white'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Título curto (até 6 palavras) que resume o conteúdo, no mesmo idioma das notas.' },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: 'Texto da nota, transcrito como está escrito.' },
          color: { type: 'string', enum: NOTE_COLORS },
          x: { type: 'number', description: 'Centro horizontal da nota na foto, de 0 (esquerda) a 1 (direita).' },
          y: { type: 'number', description: 'Centro vertical da nota na foto, de 0 (topo) a 1 (base).' },
        },
        required: ['text', 'color', 'x', 'y'],
      },
    },
  },
  required: ['title', 'notes'],
};

const SYSTEM_PROMPT = `You turn photos into digital sticky notes for a collaborative whiteboard.

The photo may show physical sticky notes, a whiteboard, a flip chart, a notebook page, or other handwritten or printed notes. Create one note per physical sticky note in the photo. If there are no sticky notes, create one note per distinct idea, bullet or list item instead — don't split one sentence across notes and don't merge separate items.

For each note:
- text: transcribe what is written, in its original language. Keep meaningful line breaks, correct only obvious misreadings of handwriting, and never invent content. If a word is illegible, give your best reading followed by "(?)".
- color: the allowed color closest to the physical note. Use "yellow" when the notes have no color of their own (for example, text written on a whiteboard).
- x, y: the center of the note in the photo as fractions of the image width and height.

Ignore text that isn't part of the content, such as brand names printed on pads, watermarks, or app interface elements in screenshots. If the photo has no legible notes, return an empty list.`;

export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const apiKey = () => (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const model = () => (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();

export function aiStatus() {
  return { enabled: Boolean(apiKey()), provider: 'Google Gemini', model: model() };
}

function postJSON(path, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request(
      { hostname: API_HOST, port: 443, path, method: 'POST', headers: { ...headers, 'content-length': data.length } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            /* resposta não-JSON */
          }
          resolve({ status: res.statusCode, headers: res.headers, json });
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });
    req.on('error', reject);
    req.end(data);
  });
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function errorMessage(json, status) {
  return (json && json.error && (json.error.message || json.error.status)) || `HTTP ${status}`;
}

async function call(path, headers, body) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await postJSON(path, headers, body, 180000);
    } catch (err) {
      if (err.code === 'ETIMEDOUT') throw new AiError('A IA demorou demais para responder. Tente novamente.', 504);
      last = err;
      if (attempt < 2) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new AiError(`Não foi possível conectar à API do Gemini (${err.code || err.message}). Verifique a internet.`, 502);
    }
    if (res.status >= 200 && res.status < 300) return res;
    if (RETRYABLE.has(res.status) && attempt < 2) {
      const retryAfter = Number(res.headers['retry-after']);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 15) * 1000 : 1000 * 2 ** attempt);
      last = res;
      continue;
    }
    return res;
  }
  return last;
}

function mapHttpError(status, message) {
  const msg = String(message || '');
  if (status === 400 && /api key/i.test(msg)) {
    return new AiError('Chave do Gemini inválida. Confira GEMINI_API_KEY no arquivo .env.', 502);
  }
  switch (status) {
    case 400:
      return new AiError(`O Gemini recusou a requisição: ${msg}`, 502);
    case 401:
    case 403:
      return new AiError('Chave do Gemini inválida ou sem permissão. Confira GEMINI_API_KEY no arquivo .env.', 502);
    case 404:
      return new AiError(`Modelo não encontrado (${model()}). Confira GEMINI_MODEL no arquivo .env.`, 502);
    case 413:
      return new AiError('A imagem é grande demais para o Gemini.', 413);
    case 429:
      return new AiError('Limite de uso do Gemini atingido. Aguarde um pouco e tente de novo.', 429);
    default:
      return new AiError('O Gemini está indisponível ou sobrecarregado no momento. Tente novamente.', 503);
  }
}

/** Junta o texto de resposta, aceitando o formato da Interactions API e o clássico generateContent. */
function extractText(json) {
  if (!json || typeof json !== 'object') return '';
  if (typeof json.output_text === 'string') return json.output_text;
  const textOf = (blocks) =>
    (Array.isArray(blocks) ? blocks : [])
      .filter((b) => b && typeof b.text === 'string' && (!b.type || b.type === 'text'))
      .map((b) => b.text)
      .join('');
  if (Array.isArray(json.steps)) {
    const outputs = json.steps.filter((s) => s && s.type === 'model_output');
    const step = outputs[outputs.length - 1];
    if (step) return textOf(step.content);
  }
  if (Array.isArray(json.outputs)) return textOf(json.outputs);
  if (Array.isArray(json.candidates) && json.candidates[0] && json.candidates[0].content) {
    return textOf(json.candidates[0].content.parts);
  }
  return '';
}

function blockedReason(json) {
  if (!json) return null;
  if (json.promptFeedback && json.promptFeedback.blockReason) return json.promptFeedback.blockReason;
  const c = Array.isArray(json.candidates) ? json.candidates[0] : null;
  if (c && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY'].includes(c.finishReason)) return c.finishReason;
  return null;
}

const clamp01 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

/**
 * @param {{ mediaType: string, data: string, hint?: string }} input  imagem em base64
 * @returns {Promise<{ title: string, notes: {text:string,color:string,x:number,y:number}[], model: string }>}
 */
export async function photoToNotes({ mediaType, data, hint }) {
  const key = apiKey();
  if (!key) {
    throw new AiError('A IA ainda não está configurada: defina GEMINI_API_KEY no arquivo .env e reinicie o servidor.', 503);
  }
  const mdl = model();
  let instruction = 'Transforme esta foto em post-its digitais.';
  if (hint) instruction += `\n\nInstruções adicionais de quem enviou a foto:\n${hint}`;

  const headers = { 'content-type': 'application/json', 'x-goog-api-key': key, 'api-revision': API_REVISION };
  let res = await call(INTERACTIONS_PATH, headers, {
    model: mdl,
    system_instruction: SYSTEM_PROMPT,
    input: [
      { type: 'text', text: instruction },
      { type: 'image', data, mime_type: mediaType },
    ],
    generation_config: { thinking_level: 'medium', max_output_tokens: 16384 },
    response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
  });

  // Contas/regiões sem a Interactions API: usa o endpoint clássico generateContent.
  if (res.status === 404 && !/model/i.test(errorMessage(res.json, 404))) {
    res = await call(`/v1beta/models/${encodeURIComponent(mdl)}:generateContent`, { 'content-type': 'application/json', 'x-goog-api-key': key }, {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: instruction }, { inlineData: { mimeType: mediaType, data } }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMA, maxOutputTokens: 16384 },
    });
  }
  if (res.status < 200 || res.status >= 300) throw mapHttpError(res.status, errorMessage(res.json, res.status));

  if (blockedReason(res.json)) throw new AiError('O Gemini não pôde processar esta imagem.', 422);
  const text = extractText(res.json);
  if (!text.trim()) throw new AiError('O Gemini não retornou conteúdo para esta foto. Tente novamente.', 502);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiError('A IA respondeu em um formato inesperado (talvez a resposta tenha sido cortada). Tente recortar a foto.', 502);
  }
  const notes = (Array.isArray(parsed.notes) ? parsed.notes : [])
    .slice(0, 200)
    .map((n) => ({
      text: String((n && n.text) || '').trim().slice(0, 2000),
      color: NOTE_COLORS.includes(n && n.color) ? n.color : 'yellow',
      x: clamp01(n && n.x),
      y: clamp01(n && n.y),
    }))
    .filter((n) => n.text);
  return { title: String(parsed.title || '').trim().slice(0, 120), notes, model: mdl };
}
