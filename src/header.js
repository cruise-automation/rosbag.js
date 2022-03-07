// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import { extractFields } from "./fields";
import { Record } from "./record";

// given a buffer parses out the record within the buffer
// based on the opcode type bit
export function parseHeader<T: Record>(
  buffer: Uint8Array,
  cls: Class<T> & { opcode: number }
): { [key: string]: Uint8Array } {
  const fields = extractFields(buffer);
  if (fields.op === undefined) {
    throw new Error("Header is missing 'op' field.");
  }
  const view = new DataView(fields.op.buffer);
  const opcode = view.getUint8(fields.op.byteOffset);

  if (opcode !== cls.opcode) {
    throw new Error(`Expected ${cls.name} (${cls.opcode}) but found ${opcode}`);
  }

  return fields;
}
