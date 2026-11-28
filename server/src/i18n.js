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
    membership_request: ['Membership request', '{client} wants "{plan}".'],
    membership_accepted: ['Membership approved', '{org}: your "{plan}" membership is active until {until}. Pay at the location.'],
    membership_declined: ['Membership declined', '{org} could not approve "{plan}".'],
    booking_reminder: ['Starts in 1 hour', '{title} at {org} starts at {time}.'],
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
    device_unknown: 'an unknown device',
    confirm_subject: 'Confirm your email',
    confirm_body: 'Hello,\n\nTo finish creating your account, open this link (valid for 24 hours):\n{link}\n\nIf you did not create an account, ignore this email: without the link the account stays inactive.\n\nRequested from: {device}',
    signup_existing_subject: 'Someone tried to create an account with your email',
    signup_existing_body: 'Hello,\n\nOn {when}, someone tried to create a new account with this email address, from {device}.\n\nIf it was you: you already have an account. Sign in, or use "Forgot password" in the app.\n\nIf it was not you: you do not need to do anything. Nobody can enter your account without your password, and no new account was created.',
    recover_subject: 'Reset your password',
    recover_body: 'Hello,\n\nOn {when}, a new password was requested for your account, from {device}.\n\nTo choose a new password, open this link (valid for one hour, works once):\n{link}\n\nIf it was not you: ignore this email. Your password stays the same.',
    owner_closed_subject: '{org} was closed',
    owner_closed_body: 'Hello,\n\n{org} was closed by the administrator. Its workouts, pictures and upcoming bookings were removed, and your clients were told by email.\n\nYour login still works: sign in with this email to create a new organization.\n\n— {default}',
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
    membership_request: ['Cerere de abonament', '{client} vrea „{plan}”.'],
    membership_accepted: ['Abonament aprobat', '{org}: abonamentul „{plan}” este activ până pe {until}. Plata se face la locație.'],
    membership_declined: ['Abonament respins', '{org} nu a putut aproba „{plan}”.'],
    booking_reminder: ['Începe peste o oră', '{title} la {org} începe la {time}.'],
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
    device_unknown: 'un dispozitiv necunoscut',
    confirm_subject: 'Confirmă-ți emailul',
    confirm_body: 'Bună,\n\nCa să termini crearea contului, deschide acest link (valabil 24 de ore):\n{link}\n\nDacă nu tu ai creat contul, ignoră acest email: fără link, contul rămâne inactiv.\n\nCerut de pe: {device}',
    signup_existing_subject: 'Cineva a încercat să creeze un cont cu emailul tău',
    signup_existing_body: 'Bună,\n\nPe {when}, cineva a încercat să creeze un cont nou cu această adresă de email, de pe {device}.\n\nDacă ai fost tu: ai deja un cont. Intră în cont sau folosește „Am uitat parola” în aplicație.\n\nDacă nu ai fost tu: nu trebuie să faci nimic. Nimeni nu poate intra în contul tău fără parolă și nu s-a creat niciun cont nou.',
    recover_subject: 'Resetează-ți parola',
    recover_body: 'Bună,\n\nPe {when}, s-a cerut o parolă nouă pentru contul tău, de pe {device}.\n\nCa să alegi o parolă nouă, deschide acest link (valabil o oră, o singură dată):\n{link}\n\nDacă nu ai fost tu: ignoră acest email. Parola ta rămâne aceeași.',
    owner_closed_subject: '{org} a fost închisă',
    owner_closed_body: 'Bună,\n\n{org} a fost închisă de administrator. Exercițiile, imaginile și rezervările viitoare au fost șterse, iar clienții tăi au fost anunțați prin email.\n\nContul tău rămâne: intră cu acest email ca să creezi o organizație nouă.\n\n— {default}',
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
