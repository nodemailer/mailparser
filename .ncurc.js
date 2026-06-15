'use strict';

module.exports = {
    upgrade: true,
    // mailparser ships inside @yao-pkg/pkg binaries (via EmailEngine and other
    // downstream projects), so every dependency must stay CommonJS-compatible.
    // Reject any package whose newer releases moved to pure ESM - pkg cannot
    // bundle ESM-only modules. Add the offending package name here when an
    // upgrade flips it to ESM.
    reject: []
};
