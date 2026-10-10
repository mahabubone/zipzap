/**
 * Babel config for the rider app.
 *
 * `babel-preset-expo` alone. No `react-native-reanimated/plugin`, because this app does not depend
 * on Reanimated: `react-native-screens` and `react-native-safe-area-context` are both already
 * AndroidX-based and work with the stock preset, and adding a plugin for a library that is not
 * installed would break the Metro resolver rather than the animation.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
