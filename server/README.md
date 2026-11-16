# Server

Node.js 22, no npm packages (only Node's built-in modules), so there is nothing to install or keep updated.

| File | Job |
| --- | --- |
| `src/app.js` | HTTP routes under `/api`, login check (verifies the auth service's token) |
| `src/db.js` | Database access through PostgREST: as the user (security rules apply) or as the service |
| `src/media.js` | Uploads to disk, signed links for nginx, FFmpeg conversion (720p + 1080p, faststart, upright phone videos) |
| `src/events.js` | Background worker for the `events` table: media processing, booking notifications, payment capture/refund |
| `src/payments.js` | Stripe Connect onboarding, booking payments (authorize → capture on accept), webhook |
| `src/push.js` | Apple (APNs) and Google (FCM) push, sent directly; removes dead device tokens |
| `src/mail.js` | SMTP client for "organization closed" and "account deleted" emails |
| `src/account.js` | Delete my account, close an organization |
| `src/i18n.js` | Notification and email texts in English and Romanian |

## How a paid booking flows

1. Client books a slot → booking `pending`, payment `requires_payment` (slot held 30 minutes).
2. App calls `POST /api/bookings/:id/pay`, shows Stripe's payment sheet → card authorized, not charged.
3. Stripe webhook → payment `authorized` → owner gets "New booking request".
4. Owner accepts → card charged; Stripe sends the owner's share to their bank, keeps the platform fee (10% on the commission plan).
   Owner declines → authorization released, nothing charged.
5. Cancelled after the charge → full refund (platform fee included).
6. Not decided within 6 days → declined automatically (card authorizations expire after 7).

Free bookings (or plan "no online payment") skip steps 2–3 and 5.

## Tests

```bash
node --test                                    # unit + FFmpeg
TEST_DB_URL=postgresql://... node --test       # + end to end against a migrated database
```
