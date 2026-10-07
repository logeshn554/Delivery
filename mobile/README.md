# GoServe Android and iPhone apps

This Expo/React Native project contains native customer and partner screens that use the same backend as the website. Accounts use device-secured bearer sessions; customers submit requests and follow status/location updates; partners accept jobs, open Google Maps navigation, and explicitly enable background location sharing for an active assignment.

## Configuration

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your reachable HTTPS backend origin. On a physical phone, localhost refers to that phone; use a reachable development backend for testing. Do not put any secret into variables beginning `EXPO_PUBLIC_`.

One GoServe app supports Android and iOS with a shared sign-in screen. Account type is chosen only during registration: customer, delivery partner, business, or restaurant. The stored account role determines the workspace after sign-in. Administrator roles cannot be selected during registration. The launch country is India; the first city remains to be selected.

Install dependencies with `npm install`. Use `npm start` for development. Background location requires a development/native build, not Expo Go. Run `npm run android` with Android SDK/JDK available. iOS device/simulator builds require macOS/Xcode or an EAS build account. Review and replace bundle identifiers, provide store signing credentials, and configure EAS project identity before release builds.

## Background tracking

Only the delivery-partner workflow requests background permissions. The user receives an explanation before enabling it, Android shows a foreground-service notification, and iOS shows its location indicator. The background task sends the newest location only for the securely stored active job. The server rejects tracking from unassigned/suspended partners and completed jobs; the native task stops on those responses. Job completion/sign-out also stops sharing. Customer updates refresh every 10 seconds while the screen is active.

Background behavior depends on OS/vendor battery policies. Terminating the app can stop tracking. Real device permission, screen-lock, battery, network loss, job completion, and store-review verification remain required. No native app binary has been signed or released.

See official documentation for [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/), [TaskManager](https://docs.expo.dev/versions/latest/sdk/task-manager/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), and [Google Maps navigation URLs](https://developers.google.com/maps/documentation/urls/get-started).
