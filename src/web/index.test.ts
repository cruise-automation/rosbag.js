// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { Blob as NodeBlob } from "buffer";
import { Reader, extractFields, extractTime } from ".";

describe("browser reader", () => {
  let mockFileReader: any;
  beforeEach(() => {
    mockFileReader = {
      readAsArrayBuffer: jest.fn(),
    } as any;

    global.FileReader = jest.fn(() => mockFileReader) as any;
  });

  afterEach(() => {
    // @ts-expect-error The operand of a 'delete' operator must be optional.
    delete global.FileReader;
  });

  it("works in node", (done) => {
    const buffer = new NodeBlob([Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04])]) as any;
    const reader = new Reader(buffer);
    reader.read(0, 2, (err: Error | null, res: any) => {
      expect(err).toBeNull();
      expect(res).toHaveLength(2);
      expect(res instanceof Buffer).toBe(true);
      expect(res[0]).toBe(0x00);
      expect(res[1]).toBe(0x01);
      done();
    });

    expect(mockFileReader.readAsArrayBuffer).toHaveBeenCalledWith(new NodeBlob([Uint8Array.from([0x00, 0x01])]));
    mockFileReader.result = [0x00, 0x01];
    mockFileReader.onload({});
  });

  it("reports browser FileReader errors", (done) => {
    global.FileReader = class FailReader {
      onerror: any;
      error: any;
      readAsArrayBuffer() {
        setTimeout(() => {
          this.error = {
            message: "fake error",
          };

          expect(typeof this.onerror).toBe("function");
          this.onerror(this);
        });
      }
    } as any;

    const buffer = new NodeBlob([Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04])]) as any;
    const reader = new Reader(buffer);

    reader.read(0, 2, (err: Error | null) => {
      expect(err instanceof Error).toBe(true);

      expect(err!.message).toBe("fake error");
      done();
    });
  });

  it("exposes other methods", () => {
    expect(extractFields).toBeDefined();
    expect(extractTime).toBeDefined();
  });
});
