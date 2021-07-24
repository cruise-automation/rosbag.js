/** @jest-environment jsdom */

// Copyright 2018-2020 Cruise LLC
// Copyright 2021 Foxglove Technologies Inc
//
// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import * as fs from "fs";

import Bag, { Reader } from ".";

describe("browser reader", () => {
  it("works in node", async () => {
    const buffer = new Blob([Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04])]);
    const reader = new Reader(buffer);
    await new Promise<void>((resolve) => {
      reader.read(0, 2, (err?: Error | null, res?: unknown) => {
        expect(err).toBeNull();
        expect(res).toHaveLength(2);
        expect(res instanceof Buffer).toBe(true);
        const buff = res as Buffer;
        expect(buff[0]).toBe(0x00);
        expect(buff[1]).toBe(0x01);
        resolve();
      });
    });
  });

  it("propagates error for truncated bag", async () => {
    const data = fs.readFileSync(`${__dirname}/../../fixtures/example.bag`);
    const file = new File([data.slice(0, data.length - 1)], "example.bag");
    await expect(Bag.open(file)).rejects.toThrow("out of range");
  });

  it("allows multiple read operations at once", async () => {
    const buffer = new Blob([Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04])]);
    const reader = new Reader(buffer);
    const read1 = new Promise<void>((resolve, reject) =>
      reader.read(0, 2, (err?: Error | null) => (err != null ? reject(err) : resolve()))
    );
    const read2 = new Promise<void>((resolve, reject) =>
      reader.read(0, 2, (err?: Error | null) => (err != null ? reject(err) : resolve()))
    );
    await expect(Promise.all([read1, read2])).resolves.toBeDefined();
  });

  it("reports browser FileReader errors", async () => {
    const buffer = new Blob([Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04])]);
    const reader = new Reader(buffer);
    const actualFileReader = global.FileReader;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).FileReader = class FailReader {
      onerror!: (_: this) => void;
      readAsArrayBuffer() {
        setTimeout(() => {
          Object.defineProperty(this, "error", {
            get() {
              return new Error("fake error");
            },
          });

          expect(typeof this.onerror).toBe("function");
          this.onerror(this);
        });
      }
    };

    await new Promise<void>((resolve) => {
      reader.read(0, 2, (err?: Error | null) => {
        global.FileReader = actualFileReader;
        expect(err instanceof Error).toBe(true);
        expect(err!.message).toBe("fake error");
        resolve();
      });
    });
  });
});
