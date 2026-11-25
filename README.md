# Pino — quadro branco colaborativo

Quadro interativo em tempo real (no estilo de ferramentas como o Miro) para dinâmicas em equipe:
post-its, estruturas, desenhos, timer com alarme e um agente de IA que transforma a foto de
post-its/anotações em post-its digitais.

Feito em **JavaScript puro**: o servidor usa só o Node.js (sem `npm install`, sem dependências)
e o navegador usa só HTML/CSS/JS. Tudo é salvo em arquivos **JSON** na pasta `data/`.

## Como iniciar

**Windows:** dê dois cliques em **`iniciar.bat`**. Ele confere o Node, cria o `.env` na
primeira vez, sobe o servidor e abre o navegador.

**Qualquer sistema:**

```bash
node server.js          # http://localhost:3000
PORT=4000 node server.js
```

Requisito: **Node.js 17 ou mais recente**. Nada mais precisa ser instalado.

Ao subir, o terminal mostra também o endereço de rede (ex.: `http://192.168.0.10:3000`).
Envie esse endereço para quem está em outro computador da mesma rede.

## IA: Foto → Post-its (Google Gemini)

1. Crie uma chave em <https://aistudio.google.com/apikey>.
2. Copie `.env.example` para `.env` (o `iniciar.bat` faz isso sozinho) e preencha:

   ```ini
   GEMINI_API_KEY=sua-chave
   GEMINI_MODEL=gemini-4-carbon   # opcional
   ```

3. Reinicie o servidor.

O modelo padrão é o **`gemini-4-carbon`**, o de maior precisão multimodal do Google, indicado
para ler letra à mão. Se preferir respostas mais rápidas e baratas, use `gemini-4-hydrogen`.

No quadro, clique no botão roxo **✦ (Foto → Post-its)**, escolha ou tire uma foto (no celular
abre a câmera). A IA lê cada nota, identifica a cor e a posição; você revisa o texto, desmarca o
que não quiser e os post-its são criados, opcionalmente agrupados numa área com título e
mantendo a disposição da foto.

A chamada é feita pelo servidor (`lib/ai.js`) via HTTPS para a Interactions API do Gemini.
A chave nunca vai para o navegador.

## Funcionalidades

- **Contas:** cadastro e login simples (senha com hash `scrypt`, sessão em cookie `HttpOnly`).
- **Tempo real:** todos veem as alterações na hora, com o **cursor de cada pessoa se movendo**
  (com nome e cor), avatares de quem está online, a seleção dos outros destacada e
  "Trazer todos para minha visão".
- **Post-its:** duplo clique no vazio cria um; os botões **+** ao redor criam o vizinho; o texto
  se ajusta sozinho ao tamanho; 10 cores; "Organizar em grade".
- **Estruturas:** 9 modelos prontos (Kanban, Retrospectiva, SWOT, Impacto × Esforço, Business
  Model Canvas, Mapa de empatia, Roadmap, 5W2H, Brainstorm) e **importação de PNG ou SVG como
  estrutura**. A estrutura fica atrás e os post-its colocados sobre ela se movem junto.
- **Desenho:** caneta, marca-texto, setas, formas (retângulo, elipse, losango, triângulo),
  textos, áreas (frames) e borracha.
- **Timer da equipe:** compartilhado entre todos, com presets, pausa, +1 min, bipes nos últimos
  5 segundos e **alarme sonoro** ao terminar (o alarme é gerado pelo navegador, sem arquivos de áudio).
- **Compartilhar:** link com permissão (editar / só ver / privado) e convite por e-mail.
- **Exportar:** PNG em alta resolução, SVG vetorial (quadro inteiro ou só a seleção) e backup
  `.json` com as imagens embutidas. **Importar:** imagens, SVG e backups, por menu, arrastando
  arquivos para o quadro ou colando (Ctrl+V).
- Desfazer/refazer, copiar/colar entre quadros, travar itens, camadas, zoom/pan com mouse,
  trackpad e toque (pinça), e layout para celular.

Atalhos: menu **⋯ → Atalhos de teclado** dentro do quadro.

## Onde ficam os dados

```
data/
  users.json            contas
  sessions.json         sessões de login
  boards/<id>.json      um arquivo por quadro (itens, membros, timer)
  assets.json           índice das imagens
  assets/<id>.json      cada imagem (base64 dentro do JSON)
```

As gravações são atômicas e agrupadas. Ao encerrar com Ctrl+C, o que estiver pendente é salvo.
Para fazer backup, basta copiar a pasta `data/`.

## Estrutura do código

```
server.js            HTTP + WebSocket, rotas das páginas
lib/
  ws.js              servidor WebSocket (RFC 6455) sem bibliotecas
  collab.js          salas, operações, presença, timer
  api.js             API REST (auth, quadros, compartilhamento, imagens, IA)
  ai.js              agente Foto → Post-its (Google Gemini)
  store.js           persistência em JSON
  auth.js, access.js, sanitize.js, http.js, env.js, util.js
public/
  login.html, index.html, board.html
  css/               estilos
  js/                painel, login e módulos compartilhados (modelos, ícones, texto)
  js/board/          o quadro: estado, renderização, interação, ferramentas, timer, IA, exportação
```
