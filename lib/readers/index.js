// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

let Reader;

// borrowing this webpack detection technique from
// https://github.com/thejameskyle/react-loadable/blob/master/src/index.js#L9
if (typeof __webpack_modules__ === "object") {
  // eslint-disable-line
  // this is set to true in webpack config
  Reader = require("./browser"); // eslint-disable-line
} else {
  // otherwise we're in node
  Reader = require("./node"); // eslint-disable-line
}

module.exports = Reader;
