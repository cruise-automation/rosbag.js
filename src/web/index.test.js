// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import { Reader } from ".";

describe("browser reader", () => {
  it("works in node", (done) => {
    const buffer = new Blob([Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04])]);
    const reader = new Reader(buffer);
    reader.read(0, 2, (err: Error | null, res: any) => {
      expect(err).toBeNull();
      expect(res).toHaveLength(2);
      expect(res instanceof Buffer).toBe(true);
      expect(res[0]).toBe(0x00);
      expect(res[1]).toBe(0x01);
      done();
    });
  });

  it("calls back with an error if read is called twice", (done) => {
    const buffer = new Blob([Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04])]);
    const reader = new Reader(buffer);
    reader.read(0, 2, () => {});
    reader.read(0, 2, (err: Error | null) => {
      expect(err instanceof Error).toBe(true);
      done();
    });
  });

  it("reports browser FileReader errors", (done) => {
    const buffer = new Blob([Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04])]);
    const reader = new Reader(buffer);

    // mock readAsArrayBuffer to emulate an error
    // $FlowFixMe - readAsArrayBuffer is not writeable
    reader._fileReader.readAsArrayBuffer = function() {
      setTimeout(() => {
        // $FlowFixMe - `value` is missing in object literal
        Object.defineProperty(this, "error", {
          get() {
            return "fake error";
          },
        });

        expect(typeof this.onerror).toBe("function");
        this.onerror(this);
      });
    };

    reader.read(0, 2, (err: Error | null) => {
      expect(err instanceof Error).toBe(true);

      // $FlowFixMe - `message` is missing in null
      expect(err.message).toBe("fake error");
      done();
    });
  });
});
