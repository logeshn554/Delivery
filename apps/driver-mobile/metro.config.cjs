const path = require('node:path');
const {getDefaultConfig} = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, '../..');
config.watchFolders = [root];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [path.join(root, 'node_modules')];
module.exports = config;
