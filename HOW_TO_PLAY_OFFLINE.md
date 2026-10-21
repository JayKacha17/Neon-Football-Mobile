# Neon Football Mobile — 100% Offline Wi-Fi LAN Multiplayer Guide

Welcome to **Neon Football Mobile**! This edition allows you and your friends to play a 3D multiplayer football game directly on your mobile screens over a local Wi-Fi router or phone hotspot — **with 0 internet required**.

---

## 🚀 Quick Start (In 3 Simple Steps)

### Method 1: Using Phone Hotspot (Play Anywhere: Bus, Train, Dorm, Outdoor)
No internet or cellular data is needed! 

1. **Turn ON Personal Hotspot** on Phone 1 (you can turn cellular data completely OFF).
2. **Connect Phone 2 (and 3, 4)** to Phone 1's Wi-Fi Hotspot.
3. **Start the Match**:
   - Double-click `START_LAN_SERVER.bat` on your PC/laptop (connected to the same hotspot/Wi-Fi).
   - The terminal will display your exact LAN IP (e.g. `http://192.168.43.1:3000`).
   - On the phones, open that link in Chrome or Safari.
   - Tap **"Play on Mobile (3D Touch)"** or go directly to `http://<IP>:3000/mobile`.
   - Players can now see the match on their phones and control their players using the on-screen touch joystick and action buttons!

---

### Method 2: Home Wi-Fi Router (Zero Internet Needed)
1. Ensure all phones and your computer are connected to the **same home Wi-Fi network** (even if the router has no active internet!).
2. Double-click `START_LAN_SERVER.bat`.
3. Open the link displayed on the screen on each mobile phone.
4. One player hosts or starts the match, and other players join using the 4-letter Room Code!

---

### Method 3: Instant Solo Offline Mode (No Wi-Fi, No Server Needed)
If you are alone or just want to practice:
1. Open the mobile game (`/mobile`).
2. Tap **SOLO OFFLINE MATCH**.
3. The game runs local physics and 3D graphics directly in your browser against AI bots.

---

## 📱 Mobile Touch Controls

- **Left Thumb:** Virtual analog thumbstick (drag to run and aim dribble/kicks; hold to keep running in that direction).
- **Right Thumb:**
  - ⚡ **BOOST (SPRINT):** Accelerates player by 1.5x speed.
  - ⚽ **SHOOT:** Fires a powerful shot toward the goal or in the direction of your joystick.
  - 🎯 **PASS / TACKLE:** Passes the ball or performs a slide tackle when defending.
- **Top Right:** Minimap / Pitch Radar showing real-time dots of all players and the ball.

---

## 📦 How to Install as a Native App on Phone (PWA)
1. Open `http://<LAN-IP>:3000/mobile` in your mobile browser.
2. On Android (Chrome): Tap the 3 dots menu -> **"Add to Home screen"** or **"Install app"**.
3. On iOS (Safari): Tap the Share button -> **"Add to Home Screen"**.
4. The game will now launch full-screen like a real native app without browser bars!

---

## 🛠️ Building a Native Android APK (Optional)
If you want to compile an `.apk` file:
```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init
npx cap add android
npx cap open android
```
Then click **Build > Build Bundle(s) / APK(s) > Build APK(s)** in Android Studio.
