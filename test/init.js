// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// run before all tests
require("babel-register")({
  babelrc: false,
  plugins: ["transform-es2015-modules-commonjs"],
});

// tiny polyfill for the parts of the FileReader API we use
global.FileReader = class FileReader {
  readAsArrayBuffer(buffer) {
    this.result = buffer;
    setImmediate(this.onload);
  }
};
