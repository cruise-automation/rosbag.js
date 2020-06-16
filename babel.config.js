// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

module.exports = {
  plugins: ["@babel/plugin-proposal-class-properties", "@babel/plugin-syntax-object-rest-spread", "@babel/plugin-proposal-optional-catch-binding"],
  presets: ["@babel/preset-flow"],
  env: {
    test: {
      presets: ["@babel/preset-env"],
    },
  },
};
