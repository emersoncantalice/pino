/**
 * Servidor WebSocket mínimo (RFC 6455) sem dependências.
 * Suporta mensagens de texto/binárias, fragmentação, ping/pong e close.
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function rejectUpgrade(socket, status, text) {
  try {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    socket.destroy();
  }
}

export function acceptUpgrade(req, socket, head, { maxPayload = 4 * 1024 * 1024 } = {}) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || !key) {
    rejectUpgrade(socket, 400, 'Bad Request');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const ws = new WsConnection(socket, maxPayload);
  if (head && head.length) ws._onData(head);
  return ws;
}

class WsConnection extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentSize = 0;
    this.fragmentOpcode = 0;
    this.closed = false;
    this.finished = false;
    this.isAlive = true;
    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._finish());
    socket.on('end', () => this._finish());
    socket.on('error', () => this._finish());
  }

  get open() {
    return !this.closed && !this.socket.destroyed;
  }

  send(text) {
    if (!this.open) return;
    this._frame(0x1, Buffer.from(text, 'utf8'));
  }

  ping() {
    if (this.open) this._frame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const r = Buffer.from(String(reason).slice(0, 120), 'utf8');
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this._frame(0x8, payload);
    this.closed = true;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2000).unref();
  }

  terminate() {
    this.closed = true;
    this.socket.destroy();
    this._finish();
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.closed = true;
    this.emit('close');
  }

  _frame(opcode, payload) {
    if (this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, payload]));
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (!this.closed) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) return this.close(1009, 'Mensagem muito grande');
        len = Number(big);
        offset = 10;
      }
      if (!masked) return this.close(1002, 'Frame sem máscara');
      if (len > this.maxPayload) return this.close(1009, 'Mensagem muito grande');
      if (buf.length < offset + 4 + len) return;
      const mask = buf.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buf.subarray(offset, offset + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = buf.subarray(offset + len);
      this._onFrame(fin, opcode, payload);
    }
  }

  _onFrame(fin, opcode, payload) {
    this.isAlive = true;
    switch (opcode) {
      case 0x8: {
        // close: responde e encerra
        if (!this.closed) {
          this._frame(0x8, payload.subarray(0, 2));
          this.closed = true;
          this.socket.end();
        }
        this._finish();
        return;
      }
      case 0x9:
        this._frame(0xa, payload);
        return;
      case 0xa:
        return;
      case 0x1:
      case 0x2:
        if (this.fragments.length) return this.close(1002, 'Fragmentação inválida');
        if (fin) return this._emitMessage(opcode, payload);
        this.fragmentOpcode = opcode;
        this.fragments = [payload];
        this.fragmentSize = payload.length;
        return;
      case 0x0:
        if (!this.fragments.length) return this.close(1002, 'Continuação inesperada');
        this.fragments.push(payload);
        this.fragmentSize += payload.length;
        if (this.fragmentSize > this.maxPayload) return this.close(1009, 'Mensagem muito grande');
        if (fin) {
          const data = Buffer.concat(this.fragments);
          this.fragments = [];
          this.fragmentSize = 0;
          this._emitMessage(this.fragmentOpcode, data);
        }
        return;
      default:
        this.close(1002, 'Opcode desconhecido');
    }
  }

  _emitMessage(opcode, data) {
    this.emit('message', opcode === 0x1 ? data.toString('utf8') : data);
  }
}
