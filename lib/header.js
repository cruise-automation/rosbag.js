// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { extractFields } from "./fields";
import { BagHeader, Chunk, MessageData, IndexData, Connection, ChunkInfo } from "./record";

// given a buffer parses out the record within the buffer
// based on the opcode type bit
function parseHeader(buffer) {
  const fields = extractFields(buffer);
  if (fields.op === undefined) {
    throw new Error("Header is missing 'op' field.");
  }
  const opcode = fields.op.readUInt8(0);

  switch (opcode) {
    case 2:
      return new MessageData(fields);
    case 3:
      return new BagHeader(fields);
    case 4:
      return new IndexData(fields);
    case 5:
      return new Chunk(fields);
    case 6:
      return new ChunkInfo(fields);
    case 7:
      return new Connection(fields);
    default:
      throw new Error(`Unknown header type: ${opcode}`);
  }
}

export { parseHeader }; // eslint-disable-line import/prefer-default-export
