// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import { extractFields, extractTime } from "./fields";
import { MessageReader } from "./MessageReader";
import type { Time } from "./types";

const readUInt32LE = (a: Uint8Array, offset: number) => {
  const view = new DataView(a.buffer);
  return view.getUint32(a.byteOffset + offset, true);
};

const readInt32LE = (a: Uint8Array, offset: number) => {
  const view = new DataView(a.buffer);
  return view.getInt32(a.byteOffset + offset, true);
};

const readUInt64LE = (a: Uint8Array, offset: number) => {
  const dataview = new DataView(a.buffer);
  const byteOffset = a.byteOffset + offset;

  // split 64-bit number into two 32-bit (4-byte) parts
  const left =  dataview.getUint32(byteOffset, true);
  const right = dataview.getUint32(byteOffset + 4, true);

  // combine the two 32-bit values
  const combined = left + 2 ** 32 * right;

  if (!Number.isSafeInteger(combined))
    console.warn(combined, "exceeds MAX_SAFE_INTEGER. Precision may be lost");

  return combined;
};

export class Record {
  offset: number;
  dataOffset: number;
  end: number;
  length: number;

  constructor(_fields: { [key: string]: any }, _buffer: Uint8Array) {}
}

export class BagHeader extends Record {
  static opcode = 3;
  indexPosition: number;
  connectionCount: number;
  chunkCount: number;

  constructor(fields: { [key: string]: Uint8Array }, buffer: Uint8Array) {
    super(fields, buffer);
    this.indexPosition = readUInt64LE(fields.index_pos, 0);
    this.connectionCount = readInt32LE(fields.conn_count, 0);
    this.chunkCount = readInt32LE(fields.chunk_count, 0);
  }
}

export class Chunk extends Record {
  static opcode = 5;
  compression: string;
  size: number;
  data: Uint8Array;

  constructor(fields: { [key: string]: Uint8Array }, buffer: Uint8Array) {
    super(fields, buffer);
    this.compression = new TextDecoder().decode(fields.compression);
    this.size = readUInt32LE(fields.size, 0);
    this.data = buffer;
  }
}

const getField = (fields: { [key: string]: Uint8Array }, key: string) => {
  if (fields[key] === undefined) {
    throw new Error(`Connection header is missing ${key}.`);
  }
  return new TextDecoder().decode(fields[key]);
};


export class Connection extends Record {
  static opcode = 7;
  conn: number;
  topic: string;
  type: string;
  md5sum: string;
  messageDefinition: string;
  callerid: ?string;
  latching: ?boolean;
  reader: ?MessageReader;

  constructor(fields: { [key: string]: Uint8Array }, buffer: Uint8Array) {
    super(fields, buffer);
    this.conn = readUInt32LE(fields.conn, 0);
    this.topic = new TextDecoder().decode(fields.topic);
    this.messageDefinition = "";

    const bufferFields = extractFields(buffer);
    this.type = getField(bufferFields, "type");
    this.md5sum = getField(bufferFields, "md5sum");
    this.messageDefinition = getField(bufferFields, "message_definition");
    if (bufferFields.callerid !== undefined) {
      this.callerid = new TextDecoder().decode(bufferFields.callerid);
    }
    if (bufferFields.latching !== undefined) {
      this.latching = new TextDecoder().decode(bufferFields.latching) === "1";
    }
  }
}

export class MessageData extends Record {
  static opcode = 2;
  conn: number;
  time: Time;
  data: Uint8Array;

  constructor(fields: { [key: string]: Uint8Array }, buffer: Uint8Array) {
    super(fields, buffer);
    this.conn = readUInt32LE(fields.conn, 0);
    this.time = extractTime(fields.time, 0);
    this.data = buffer;
  }
}

export class IndexData extends Record {
  static opcode = 4;
  ver: number;
  conn: number;
  count: number;
  indices: Array<{ time: Time, offset: number }>;

  constructor(fields: { [key: string]: Uint8Array }, buffer: Uint8Array) {
    super(fields, buffer);
    this.ver = readUInt32LE(fields.ver, 0);
    this.conn = readUInt32LE(fields.conn, 0);
    this.count = readUInt32LE(fields.count, 0);

    this.indices = [];
    for (let i = 0; i < this.count; i++) {
      this.indices.push({
        time: extractTime(buffer, i * 12),
        offset: readUInt32LE(buffer, i * 12 + 8),
      });
    }
  }
}

export class ChunkInfo extends Record {
  static opcode = 6;
  ver: number;
  chunkPosition: number;
  startTime: Time;
  endTime: Time;
  count: number;
  connections: Array<{ conn: number, count: number }>;
  nextChunk: ?ChunkInfo;

  constructor(fields: { [key: string]: Uint8Array }, buffer: Uint8Array) {
    super(fields, buffer);
    this.ver = readUInt32LE(fields.ver, 0);
    this.chunkPosition = readUInt64LE(fields.chunk_pos, 0);
    this.startTime = extractTime(fields.start_time, 0);
    this.endTime = extractTime(fields.end_time, 0);
    this.count = readUInt32LE(fields.count, 0);

    this.connections = [];
    for (let i = 0; i < this.count; i++) {
      this.connections.push({
        conn: readUInt32LE(buffer, i * 8),
        count: readUInt32LE(buffer, i * 8 + 4),
      });
    }
  }
}
