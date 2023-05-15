// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { extractFields } from "./fields";
import { RosbagRecord, RosbagRecordConstructor } from "./record";

/**
 * Given a buffer parses out the record within the buffer
 * based on the opcode type bit.
 */
export function parseHeader<T extends RosbagRecord>(
  buffer: Buffer,
  Cls: RosbagRecordConstructor<T>
): Record<string, Buffer> {
  const fields = extractFields(buffer);

  if (fields.op === undefined) {
    throw new Error("Header is missing 'op' field.");
  }

  const opcode = fields.op.readUInt8(0);

  if (opcode !== Cls.opcode) {
    throw new Error(`Expected ${Cls.name} (${Cls.opcode}) but found ${opcode}`);
  }

  return fields;
}
