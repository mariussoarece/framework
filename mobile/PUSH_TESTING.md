# Testing push notifications (Android emulator + iPhone)

The **Android emulator receives** the notifications (development build).
The **iPhone in Expo Go** plays the other person (books, approves, uploads).
Everything here is free. The iPhone itself can receive notifications later, with an
Apple Developer account.

---

## 1. Firebase (once, ~10 minutes)

1. Open https://console.firebase.google.com → **Create a project** (name e.g. `yogabythesofa`).
   Google Analytics: not needed.
2. In the project: **Add app → Android**.
   - Android package name: `com.yogabythesofa.app` (exactly)
   - Download **google-services.json** and put it in the `mobile/` folder.
   - The other steps of the wizard (SDK, Gradle): skip, Expo does them.
3. Commit the file (it is not a secret; the app needs it in the build):
   ```bash
   cd mobile
   git add google-services.json && git commit -m "Firebase config for Android" && git push
   ```
4. Key for the server: ⚙️ **Project settings → Service accounts → Generate new private key**.
   A `.json` file downloads. **This one is secret**: never commit it.

## 2. The key on the VPS

From the Mac (replace the file name with the one you downloaded):
```bash
scp ~/Downloads/yogabythesofa-firebase-adminsdk-xxxx.json \
    frame@45.10.163.167:/opt/framework/infra/secrets/firebase-service-account.json
```
On the VPS:
```bash
cd /opt/framework/infra
chmod 644 secrets/firebase-service-account.json
grep FCM_SERVICE_ACCOUNT_FILE .env    # must be /run/secrets/firebase-service-account.json
docker compose up -d --build api
docker compose logs --tail=20 api
```
(If `.env` has no `FCM_SERVICE_ACCOUNT_FILE` line, add:
`FCM_SERVICE_ACCOUNT_FILE=/run/secrets/firebase-service-account.json`.)

## 3. The emulator (Android Studio)

1. **Device Manager → +  → Create virtual device** → a **Pixel** phone.
2. System image: one with **Google Play** in the "Services" column (the Play Store icon).
   Without Google Play there are no push notifications.
3. Start it. Optional but helpful: open Play Store and sign in with a Google account.

## 4. The development build (online, with EAS)

1. Create a free account at https://expo.dev.
2. On the Mac, in `mobile/`:
   ```bash
   npx expo install expo-dev-client
   npx eas-cli login
   npx eas-cli init            # links the app to your Expo account (answer yes)
   ```
   `init` adds a project id to `app.json`: commit it.
3. The server address and key for the build (the build does not see your `.env` file).
   Use the same values as in `mobile/.env`:
   ```bash
   npx eas-cli env:create --environment development --visibility plaintext \
     --name EXPO_PUBLIC_API_URL --value https://api.purebalanceyoga.ro
   npx eas-cli env:create --environment development --visibility plaintext \
     --name EXPO_PUBLIC_ANON_KEY --value "PASTE_THE_ANON_KEY_FROM_.env"
   ```
4. Build:
   ```bash
   npx eas-cli build --profile development --platform android
   ```
   It takes 10–20 minutes (free builds wait in a queue). At the end you get a link
   to an **.apk** file. Download it and **drag it onto the emulator** to install.

## 5. Run

1. On the Mac: `npx expo start -c`
   - With `expo-dev-client` installed, the server starts for the development build.
     **For the iPhone in Expo Go press `s`** ("switch to Expo Go") and scan the QR code as before.
2. On the emulator: open **MyRitmio** (the new app, not Expo Go).
   If it doesn't find the server by itself, choose **Enter URL manually**: `http://10.0.2.2:8081`
3. Sign in. Allow notifications when asked.
4. **Settings → Send a test notification.** Put the app in the background: the notification
   should appear in a few seconds.

## 6. Real tests

| Emulator signed in as | iPhone (Expo Go) does | Emulator gets |
|---|---|---|
| client | owner approves the booking | Booking confirmed |
| client | owner adds a workout | New workout (after 10 min) |
| owner | client books | New booking request + red number |
| owner | client cancels | Booking cancelled |
| super admin | owner uploads a picture | Uploads to approve (after 2 min) |

Tap a notification: the app opens on the right screen.

## If the test notification says…

- **"don't work in Expo Go"** – you opened Expo Go instead of the MyRitmio app.
- **"turned off"** – emulator Settings → Apps → MyRitmio → Notifications → on.
- **"not registered"** – close the app, open it again, try again.
- **"server could not send"** – the Firebase key on the VPS: check step 2 and
  `docker compose logs --tail=50 api` (look for `push failed`).
