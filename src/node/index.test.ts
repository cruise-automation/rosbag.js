// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import fs from "fs";
import path from "path";

import { Reader } from ".";

describe("node entrypoint", () => {
  describe("Reader", () => {
    const fixture = path.join(__dirname, "..", "..", "fixtures", "asci-file.txt");

    // eslint-disable-next-line jest/no-done-callback
    it("should read bytes from a file", (done) => {
      const reader = new Reader(fixture);
      reader.read(5, 10, (err?: Error | null, buff?: Buffer | null) => {
        expect(err).toBeNull();
        expect(buff).not.toBeNull();
        expect(reader.size()).toBe(fs.statSync(fixture).size);
        expect(buff!.toString()).toBe("6789012345");
        reader.close(done);
      });
    });
  });
});
