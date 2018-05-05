// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { expect } from "chai";
import Reader from "../lib/readers/browser";

describe("browser reader", () => {
  it("works in node with some polyfills", (done) => {
    const buffer = new Buffer([0x00, 0x01, 0x02, 0x03, 0x04]);
    const reader = new Reader(buffer);
    reader.read(0, 2, (err, res) => {
      expect(err).to.equal(null);
      expect(res).to.have.length(2);
      expect(res instanceof Buffer).to.equal(true);
      expect(res[0]).to.equal(0x00);
      expect(res[1]).to.equal(0x01);
      done();
    });
  });

  it("calls back with an error if read is called twice", (done) => {
    const buffer = new Buffer([0x00, 0x01, 0x02, 0x03, 0x04]);
    const reader = new Reader(buffer);
    reader.read(0, 2, () => {});
    reader.read(0, 2, (err) => {
      expect(err instanceof Error).to.equal(true);
      done();
    });
  });
});
