export default {
  expo: {
    name: 'GoServe', slug: 'goserve', version: '1.0.0', orientation: 'portrait', userInterfaceStyle: 'light', platforms: ['ios','android'],
    ios: { bundleIdentifier: 'com.goserve.app', supportsTablet: true },
    android: { package: 'com.goserve.app' },
    plugins: ['expo-secure-store', ['expo-location', {
      locationWhenInUsePermission: 'GoServe uses your location to show the customer your position during your active delivery.',
      locationAlwaysAndWhenInUsePermission: 'GoServe shares your location during active jobs, including while you use navigation. You can stop sharing in the app.',
      isIosBackgroundLocationEnabled: true, isAndroidBackgroundLocationEnabled: true, isAndroidForegroundServiceEnabled: true,
    }]],
    extra: { country: 'IN' },
  },
};
