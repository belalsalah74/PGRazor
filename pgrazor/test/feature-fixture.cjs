// Load the feature's real factory rather than slicing an implementation region.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
module.exports = (name, dependencies, globals = {}) => {
    const context = {...globals};
    const root = path.join(__dirname, '..');
    const sources = JSON.parse(fs.readFileSync(path.join(root, 'runtime/bundles.json'), 'utf8'))['quick-close.js'];
    vm.createContext(context);
    for (const source of sources.filter(x => x.startsWith('runtime/features/')))
        vm.runInContext(fs.readFileSync(path.join(root, source), 'utf8'), context);
    return context.PGRazorFeatures[name](dependencies);
};
