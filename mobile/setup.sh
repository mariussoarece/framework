#!/usr/bin/env bash
# Installs the app's packages in versions that match the current Expo SDK.
# Run once (and again after pulling changes that add packages):
#   cd mobile && npm run setup
# Then commit the updated package.json and package-lock.json.
set -euo pipefail
cd "$(dirname "$0")"

# 1. Expo itself (latest SDK)
npm install expo@latest

# 2. Everything else, in the versions this Expo SDK expects
npx expo install \
  react react-native react-dom react-native-web \
  expo-router expo-linking expo-constants expo-status-bar \
  react-native-safe-area-context react-native-screens \
  expo-localization expo-image expo-font @expo/vector-icons \
  @react-native-async-storage/async-storage \
  @supabase/supabase-js react-native-url-polyfill \
  expo-image-picker expo-video expo-file-system expo-network \
  @10play/tentap-editor react-native-webview \
  @react-native-community/datetimepicker

npx expo install --dev typescript @types/react

# 3. Make sure all versions agree
npx expo install --fix

echo
echo "Done. Next: cp .env.example .env, fill in the server address and key, then: npx expo start"
