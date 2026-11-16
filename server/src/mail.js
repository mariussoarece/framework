// Minimal SMTP client (STARTTLS on 587, TLS on 465, AUTH LOGIN), UTF-8 plain text mail.
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

const enc = (s) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;

function lineReader(socket) {
  let buffer = '';
  const waiting = [];
  const lines = [];
  const onData = (d) => {
    buffer += d.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\r\n')) >= 0) {
      lines.push(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
    flush();
  };
  function flush() {
    // a reply ends with a line "NNN text" (space, not dash, after the code)
    const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
    if (end >= 0 && waiting.length) {
      const reply = lines.splice(0, end + 1);
      waiting.shift().resolve({ code: Number(reply.at(-1).slice(0, 3)), lines: reply });
    }
  }
  socket.on('data', onData);
  socket.on('error', (e) => { while (waiting.length) waiting.shift().reject(e); });
  return {
    next: () => new Promise((resolve, reject) => { waiting.push({ resolve, reject }); flush(); }),
    detach: () => socket.off('data', onData),
  };
}

export function createMailer(smtp, { log = console } = {}) {
  const configured = Boolean(smtp.host && smtp.from);

  async function send({ to, subject, text }) {
    if (!configured) {
      log.warn?.({ to, subject }, 'SMTP not configured; email not sent');
      return false;
    }
    const implicitTls = smtp.port === 465;
    let socket = implicitTls
      ? tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host })
      : net.connect({ host: smtp.host, port: smtp.port });
    socket.setTimeout(30000, () => socket.destroy(new Error('smtp_timeout')));
    let reader = lineReader(socket);

    const expect = async (codes) => {
      const r = await reader.next();
      if (!codes.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.lines.join(' | ')}`);
      return r;
    };
    const cmd = async (line, codes) => { socket.write(`${line}\r\n`); return expect(codes); };

    try {
      await expect([220]);
      let ehlo = await cmd('EHLO framework', [250]);
      if (!implicitTls && ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
        await cmd('STARTTLS', [220]);
        reader.detach();
        socket = tls.connect({ socket, servername: smtp.host });
        await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
        reader = lineReader(socket);
        ehlo = await cmd('EHLO framework', [250]);
      }
      if (smtp.user) {
        await cmd('AUTH LOGIN', [334]);
        await cmd(Buffer.from(smtp.user).toString('base64'), [334]);
        await cmd(Buffer.from(smtp.pass).toString('base64'), [235]);
      }
      await cmd(`MAIL FROM:<${smtp.from}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      const domain = smtp.from.split('@')[1] || 'localhost';
      const body = Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\r\n');
      const message = [
        `From: ${enc(smtp.fromName)} <${smtp.from}>`,
        `To: <${to}>`,
        `Subject: ${enc(subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${randomUUID()}@${domain}>`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        body,
        '.',
      ].join('\r\n');
      await cmd(message, [250]);
      await cmd('QUIT', [221]).catch(() => {});
      return true;
    } finally {
      socket.destroy();
    }
  }

  return { send, configured };
}
