'use strict'

// A paid endpoint may strengthen the compatibility policy. Neither the
// regional wrapper nor an explicit false may weaken global enforcement.
function callableAppCheckPolicy(broadEnforced, options = {}) {
  return broadEnforced === true || options.enforceAppCheck === true
}

module.exports = { callableAppCheckPolicy }
