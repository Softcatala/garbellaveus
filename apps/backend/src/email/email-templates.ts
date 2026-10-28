// Catalan transactional emails, text + HTML. Mirrors Arena's email_templates/
// (formal "vós" register, "do not reply" footer). Plain template functions rather
// than template files so nothing extra has to be copied into the Docker image.

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const NOTICE_HEADLINE = 'Aquest és un correu automàtic.';
const NOTICE_DETAIL = 'Si us plau, no respongueu a aquest missatge: les respostes no es processen.';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrapHtml(paragraphs: string[], footer: string[]): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join('\n');
  const small = [...footer, `${NOTICE_HEADLINE}<br>${NOTICE_DETAIL}`, '© Softcatalà']
    .map((p) => `<p style="color:#64748b;font-size:12px">${p}</p>`)
    .join('\n');
  return `<!doctype html><html lang="ca"><body style="font-family:sans-serif;color:#1e293b;max-width:560px">\n${body}\n${small}\n</body></html>`;
}

export function confirmationEmail(link: string, hours: number): EmailContent {
  const safe = escapeHtml(link);
  return {
    subject: 'Confirmeu el vostre correu a GarbellaVeus',
    text: [
      'Hola!',
      '',
      'Heu demanat rebre avisos de GarbellaVeus, el projecte de Softcatalà per avaluar la parla en català.',
      '',
      `Per confirmar l'adreça, obriu aquest enllaç (caduca d'aquí a ${hours} hores):`,
      '',
      link,
      '',
      "Si no ho heu demanat vosaltres, ignoreu aquest missatge: no es desarà res.",
      '',
      'Softcatalà',
      '',
      NOTICE_HEADLINE,
      NOTICE_DETAIL,
      '',
    ].join('\n'),
    html: wrapHtml(
      [
        'Hola!',
        'Heu demanat rebre avisos de GarbellaVeus, el projecte de Softcatalà per avaluar la parla en català.',
        `Per confirmar l'adreça, obriu aquest enllaç (caduca d'aquí a ${hours} hores):`,
        `<a href="${safe}">${safe}</a>`,
        "Si no ho heu demanat vosaltres, ignoreu aquest missatge: no es desarà res.",
      ],
      [],
    ),
  };
}

export interface ClipCard {
  text: string;
  link: string;
}

export function reminderEmail(clips: number, link: string, unsubscribeLink: string, card?: ClipCard): EmailContent {
  const safeLink = escapeHtml(link);
  const safeUnsub = escapeHtml(unsubscribeLink);
  return {
    subject: 'Cinc minuts per ajudar la IA en català?',
    text: [
      `Ja heu avaluat ${clips} talls de veu. Gràcies!`,
      '',
      'Podeu continuar avaluant i ajudar-nos a construir un conjunt de dades obert de parla catalana validada per persones.',
      '',
      ...(card
        ? [
            'Què en penseu, d\'aquesta transcripció?',
            '',
            `«${card.text}»`,
            '',
            `Escolta el tall i valida: ${card.link}`,
          ]
        : [`Avalua: ${link}`]),
      '',
      'Rebeu aquest correu perquè heu demanat els avisos de GarbellaVeus.',
      '',
      `Dona de baixa els avisos i elimina el correu: ${unsubscribeLink}`,
      '',
      NOTICE_HEADLINE,
      NOTICE_DETAIL,
      '',
      '© Softcatalà',
      '',
    ].join('\n'),
    html: wrapHtml(
      [
        `Ja heu avaluat ${clips} talls de veu. Gràcies!`,
        'Podeu continuar avaluant i ajudar-nos a construir un conjunt de dades obert de parla catalana validada per persones.',
        ...(card
          ? [
              "Què en penseu, d'aquesta transcripció?",
              `<blockquote style="margin:0;padding:8px 16px;border-left:4px solid #cbd5e1;font-size:16px">${escapeHtml(card.text)}</blockquote>`,
              `<a href="${escapeHtml(card.link)}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px">Escolta el tall i valida</a>`,
            ]
          : [`<a href="${safeLink}">Avalua</a>`]),
      ],
      [
        'Rebeu aquest correu perquè heu demanat els avisos de GarbellaVeus.',
        `<a href="${safeUnsub}">Dona de baixa els avisos i elimina el correu</a>`,
      ],
    ),
  };
}
