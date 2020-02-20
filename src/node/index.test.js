// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import assert from "assert";
import path from "path";
import fs from "fs";

import { Reader, extractFields, extractTime } from ".";

describe("node entrypoint", () => {
  describe("Reader", () => {
    const fixture = path.join(__dirname, "..", "..", "fixtures", "asci-file.txt");

    it("should read bytes from a file", (done) => {
      const reader = new Reader(fixture);
      reader.read(5, 10, (err: Error | null, buff: any) => {
        assert(!err);
        assert.equal(reader.size(), fs.statSync(fixture).size);
        assert.equal("6789012345", buff.toString());
        reader.close(done);
      });
    });
  });

  it("exposes other methods", () => {
    expect(extractFields).toBeDefined();
    expect(extractTime).toBeDefined();
  });
});
