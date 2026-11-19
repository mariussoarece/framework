# Mobile app (iOS and Android)

React Native with Expo and Expo Router, TypeScript, English and Romanian.

## First run on your Mac

You need Node.js 20+ and Xcode (for the iPhone simulator). For Android: Android Studio.

```bash
cd mobile
npm run setup                 # installs Expo and all packages in matching versions
cp .env.example .env          # then fill in:
                              #   EXPO_PUBLIC_API_URL  = https://<your DOMAIN>
                              #   EXPO_PUBLIC_ANON_KEY = ANON_KEY from infra/.env
npx expo run:ios              # builds and opens the iPhone simulator
```

`npm run setup` updates `package.json` and creates `package-lock.json`; commit both.

Later runs: `npx expo start`, then press `i` (iOS) or `a` (Android).

Checks:
```bash
npm run typecheck             # TypeScript
npm test                      # translations and rich-text tests
```

## What's in this step

| Screen | File | What it does |
| --- | --- | --- |
| Welcome | `app/welcome.tsx` | First launch: "I'm a client" / "I run a business", language switch |
| Sign in / up | `app/auth.tsx` | Email + password, email confirmation, forgot password |
| Owner setup | `app/onboarding/owner.tsx` | Organization name (unique) + payment plan, first month free |
| Client setup | `app/onboarding/client.tsx` | Join with a code, or continue with YogaByTheSofa |
| Home | `app/home.tsx` | Organization name, theme, background and foreground images, description, the two buttons |
| Settings | `app/settings.tsx` | Language, video quality, owner's join code, switch organization, sign out, delete my account |
| Edit home page | `app/edit-home.tsx` | Owner: theme, background and front image, description (rich text), button labels, icons and colors |
| Workouts | `app/workouts.tsx` | Main → sections. Owner: **+ Add section**, reorder (arrows), edit |
| Section | `app/section/[id].tsx`, `app/section-edit.tsx` | Section → workouts. Owner: big **+ Add workout**; edit name and cover, delete |
| Workout | `app/workout/[id].tsx` | Pictures/videos on top, sets × reps or time, rest, warning, what to avoid, description |
| Add / edit workout | `app/workout-edit.tsx` | Name, sets, repetitions **or** time, rest, rich-text description, pictures/videos with upload progress, warning, avoid, sections |
| Admin | `app/admin.tsx` | Super admin: preview uploads, approve or reject (with a reason for the owner) |
| Scheduling | `app/schedule.tsx`, `src/screens/` | Client: Book (classes one per line with instructor and places; open hours as time buttons), Week, My bookings. Owner: Requests, Upcoming, Week, Timetable (open hours or classes, several days at once, every week or N weeks; clashes refused), Time off (whole days, blocked sessions) |

Rich text in Expo Go: bold, italic, underline, strike, lists, links, headings, colors.
Text alignment and font choice need TenTap's advanced setup and a development build; they come with the payments step.

| Module | Job |
| --- | --- |
| `src/lib/supabase.ts` | Login and database client (talks to `/auth/v1` and `/rest/v1` on your VPS) |
| `src/lib/session.tsx` | Logged-in user, profile, organization, home page data; decides which screen to show |
| `src/lib/api.ts` | Calls to the Node server: signed media links (cached), delete account |
| `src/lib/data.ts` | Sections, workouts, home page and approvals in the database |
| `src/lib/upload.ts` | Streams a picked picture or video to the server, with progress |
| `src/lib/schedule.ts` | Times, prices and days in the organization's time zone |
| `src/lib/video.ts` | Picks 720p or 1080p from the client's setting and connection |
| `src/components/media.tsx` | Photo/video picker, video player, gallery, approval status tiles |
| `src/components/RichEditor.tsx` | The owner's rich-text editor (TipTap via TenTap) |
| `src/lib/richtext.ts` + `src/components/RichText.tsx` | Shows the owner's formatted description |
| `src/i18n/` | English and Romanian texts; errors from the server shown as friendly messages |
| `src/theme/themes.ts` | Predefined themes (Calm, Forest, Ocean, Sunset, Dojo, Minimal) and button icons |

## Before publishing

- `app.json`: set the real app name, `ios.bundleIdentifier` and `android.package` (now `com.yogabythesofa.app`).
- Add an app icon and splash screen.
