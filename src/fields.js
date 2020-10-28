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
export function extractFields(buffer: Buffer) {
  if (buffer.length < 4) {
    throw new Error("Header fields are truncated.");
  }

  let i = 0;
  const fields: { [key: string]: Buffer } = {};

  while (i < buffer.length) {
    const length = buffer.readInt32LE(i);
    i += 4;

    if (i + length > buffer.length) {
      throw new Error("Header fields are corrupt.");
    }

    // Passing a number into "indexOf" explicitly to avoid Buffer polyfill
    // slow path. See issue #87.
    const field = buffer.slice(i, i + length);
    const index = field.indexOf(EQUALS_CHARCODE);
    if (index === -1) {
      throw new Error("Header field is missing equals sign.");
    }

    fields[field.slice(0, index).toString()] = field.slice(index + 1);
    i += length;
  }

  return fields;
}

// reads a Time object out of a buffer at the given offset
export function extractTime(buffer: Buffer, offset: number): Time {
  const sec = buffer.readUInt32LE(offset);
  const nsec = buffer.readUInt32LE(offset + 4);
  return { sec, nsec };
}
