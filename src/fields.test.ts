// Copyright 2018-2020 Cruise LLC
// Copyright 2021 Foxglove Technologies Inc
//
// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { extractFields } from "./fields";

describe("fields", () => {
  it("should extract fields from a buffer", () => {
    const buffer = Buffer.alloc(24);
    buffer.writeUInt32LE(7, 0);
    buffer.write("foo=bar", 4);
    buffer.writeUInt32LE(9, 11);
    buffer.write("key=value", 15);

    const result = extractFields(buffer);
    const expected = { foo: Buffer.from("bar"), key: Buffer.from("value") };
    expect(result).toEqual(expected);
  });
});
