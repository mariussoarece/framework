// Texts the server sends (push notifications and emails), English and Romanian.

const TEXT = {
  en: {
    booking_request: ['New booking request', '{client} wants {time}.'],
    booking_accepted: ['Booking confirmed', '{org} confirmed your session on {time}.'],
    booking_declined: ['Booking declined', '{org} could not take your session on {time}. Nothing was charged.'],
    booking_cancelled_by_client: ['Booking cancelled', '{client} cancelled the session on {time}.'],
    booking_cancelled_by_owner: ['Booking cancelled', '{org} cancelled your session on {time}. Any payment is refunded.'],
    media_rejected: ['Upload not approved', 'One of your uploads was not approved: {reason}'],
    media_published: ['Upload approved', 'Your upload is now visible to your clients.'],
    report_new: ['New content report', '{org}: {what}'],
    booking_reminder: ['Reminder', '{title} at {org} starts at {time}.'],
    media_waiting_one: ['Upload to approve', '{org} added a picture or video.'],
    media_waiting_many: ['Uploads to approve', '{org} added {count} pictures/videos.'],
    workout_new_one: ['New workout', '{org} added "{name}".'],
    workout_new_many: ['New workouts', '{org} added {count} new workouts.'],
    session: 'Your session',
    org_closed_subject: '{org} has closed',
    org_closed_body:
      'Hello,\n\n{org} has closed its account in the app.\n\n'
      + 'You can keep using the app with {default}: open the app and choose "Continue with {default}", '
      + 'or join another organization with the code your trainer gives you.\n\n'
      + 'Any upcoming paid sessions have been refunded.\n\n— {default}',
    account_deleted_subject: 'Your account was deleted',
    account_deleted_body: 'Hello,\n\nYour account and its data were deleted as you asked.\n\n— {default}',
  },
  ro: {
    booking_request: ['Cerere nouă de programare', '{client} dorește {time}.'],
    booking_accepted: ['Programare confirmată', '{org} a confirmat ședința din {time}.'],
    booking_declined: ['Programare refuzată', '{org} nu poate prelua ședința din {time}. Nu s-a încasat nimic.'],
    booking_cancelled_by_client: ['Programare anulată', '{client} a anulat ședința din {time}.'],
    booking_cancelled_by_owner: ['Programare anulată', '{org} a anulat ședința din {time}. Orice plată se rambursează.'],
    media_rejected: ['Încărcare neaprobată', 'Unul dintre fișierele tale nu a fost aprobat: {reason}'],
    media_published: ['Încărcare aprobată', 'Fișierul tău este acum vizibil pentru clienți.'],
    report_new: ['Conținut raportat', '{org}: {what}'],
    booking_reminder: ['Reminder', '{title} la {org} începe la {time}.'],
    media_waiting_one: ['De aprobat', '{org} a adăugat o imagine sau un video.'],
    media_waiting_many: ['De aprobat', '{org} a adăugat {count} imagini/video-uri.'],
    workout_new_one: ['Exercițiu nou', '{org} a adăugat „{name}”.'],
    workout_new_many: ['Exerciții noi', '{org} a adăugat {count} exerciții noi.'],
    session: 'Ședința ta',
    org_closed_subject: '{org} s-a închis',
    org_closed_body:
      'Bună,\n\n{org} și-a închis contul în aplicație.\n\n'
      + 'Poți folosi în continuare aplicația cu {default}: deschide aplicația și alege „Continuă cu {default}”, '
      + 'sau alătură-te altei organizații cu codul primit de la antrenorul tău.\n\n'
      + 'Ședințele plătite programate au fost rambursate.\n\n— {default}',
    account_deleted_subject: 'Contul tău a fost șters',
    account_deleted_body: 'Bună,\n\nContul tău și datele lui au fost șterse, așa cum ai cerut.\n\n— {default}',
  },
};

const REASONS = {
  en: { processing_failed: 'the file could not be processed. Please upload it again.' },
  ro: { processing_failed: 'fișierul nu a putut fi procesat. Te rugăm să-l încarci din nou.' },
};

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

export function lang(l) {
  return l === 'ro' ? 'ro' : 'en';
}

export function t(language, key, vars = {}) {
  const l = lang(language);
  const v = TEXT[l][key];
  if (Array.isArray(v)) return { title: fill(v[0], vars), body: fill(v[1], vars) };
  return fill(v, vars);
}

export function reasonText(language, reason) {
  return REASONS[lang(language)][reason] || reason || '';
}

export function formatTime(iso, language, timeZone) {
  return new Intl.DateTimeFormat(lang(language) === 'ro' ? 'ro-RO' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone,
  }).format(new Date(iso));
}
