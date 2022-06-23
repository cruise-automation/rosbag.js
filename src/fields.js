// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import type { Time } from "./types";

// reads through a buffer and extracts { [key: string]: value: string }
// pairs - the buffer is expected to have length prefixed utf8 strings
// with a '=' separating the key and value
const EQUALS_CHARCODE = "=".charCodeAt(0);
export function extractFields(buffer: Uint8Array) {
  // console.log(buffer.length)
  if (buffer.length < 4) {
    throw new Error("Header fields are truncated.");
  }

  let i = 0;
  const fields: { [key: string]: Uint8Array } = {};
  const view = new DataView(buffer.buffer);

  while (i < buffer.length) {
    const length = view.getInt32(buffer.byteOffset + i, true);
    i += 4;

    if (i + length > buffer.length) {
      throw new Error("Header fields are corrupt.");
    }

    const field = buffer.subarray(i, i + length);
    const index = field.indexOf(EQUALS_CHARCODE);
    if (index === -1) {
      throw new Error("Header field is missing equals sign.");
    }

    const decoder = new TextDecoder();
    fields[decoder.decode(field.subarray(0, index))] = field.subarray(index + 1);
    i += length;
  }

  return fields;
}

// reads a Time object out of a buffer at the given offset
export function extractTime(buffer: Uint8Array, offset: number): Time {
  const view = new DataView(buffer.buffer);

  const sec = view.getInt32(buffer.byteOffset + offset, true);
  const nsec = view.getInt32(buffer.byteOffset + offset + 4, true);
  return { sec, nsec };
}
