import config from '../../mobile/app.config.js';
export default {expo:{...config.expo, name:'GoServe Partner', slug:'goserve-partner',
  ios:{...config.expo.ios, bundleIdentifier:'com.goserve.partner'},
  android:{...config.expo.android, package:'com.goserve.partner'}}};
