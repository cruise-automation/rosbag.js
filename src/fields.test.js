// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import { extractFields } from "./fields";

describe("fields", () => {
  it("should extract fields from a buffer", () => {
    const buffer = new Buffer(24);
    buffer.writeUInt32LE(7, 0);
    buffer.write("foo=bar", 4);
    buffer.writeUInt32LE(9, 11);
    buffer.write("key=value", 15);

    const result = extractFields(buffer);
    const expected = { foo: new Buffer("bar"), key: new Buffer("value") };
    expect(result).toEqual(expected);
  });
});
