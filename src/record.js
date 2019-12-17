// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import int53 from "int53";

import { extractFields, extractTime } from "./fields";
import { MessageReader } from "./MessageReader";
import type { Time } from "./types";

const readUInt64LE = (buffer: Buffer) => {
  return int53.readUInt64LE(buffer, 0);
};

export class Record {
  offset: number;
  dataOffset: number;
  end: number;
  length: number;

  constructor(_fields: { [key: string]: any }) {}

  parseData(_buffer: Buffer) {}
}

export class BagHeader extends Record {
  static opcode = 3;
  indexPosition: number;
  connectionCount: number;
  chunkCount: number;

  constructor(fields: { [key: string]: Buffer }) {
    super(fields);
    this.indexPosition = readUInt64LE(fields.index_pos);
    this.connectionCount = fields.conn_count.readInt32LE(0);
    this.chunkCount = fields.chunk_count.readInt32LE(0);
  }
}

export class Chunk extends Record {
  static opcode = 5;
  compression: string;
  size: number;
  data: Buffer;

  constructor(fields: { [key: string]: Buffer }) {
    super(fields);
    this.compression = fields.compression.toString();
    this.size = fields.size.readUInt32LE(0);
  }

  parseData(buffer: Buffer) {
    this.data = buffer;
  }
}

const getField = (fields: { [key: string]: Buffer }, key: string) => {
  if (fields[key] === undefined) {
    throw new Error(`Connection header is missing ${key}.`);
  }
  return fields[key].toString();
};

export class Connection extends Record {
  static opcode = 7;
  conn: number;
  topic: string;
  type: ?string;
  md5sum: ?string;
  messageDefinition: string;
  callerid: ?string;
  latching: ?boolean;
  reader: ?MessageReader;

  constructor(fields: { [key: string]: Buffer }) {
    super(fields);
    this.conn = fields.conn.readUInt32LE(0);
    this.topic = fields.topic.toString();
    this.type = undefined;
    this.md5sum = undefined;
    this.messageDefinition = "";
  }

  parseData(buffer: Buffer) {
    const fields = extractFields(buffer);
    this.type = getField(fields, "type");
    this.md5sum = getField(fields, "md5sum");
    this.messageDefinition = getField(fields, "message_definition");
    if (fields.callerid !== undefined) {
      this.callerid = fields.callerid.toString();
    }
    if (fields.latching !== undefined) {
      this.latching = fields.latching.toString() === "1";
    }
  }
}

export class MessageData extends Record {
  static opcode = 2;
  conn: number;
  time: Time;
  data: Buffer;

  constructor(fields: { [key: string]: Buffer }) {
    super(fields);
    this.conn = fields.conn.readUInt32LE(0);
    this.time = extractTime(fields.time, 0);
  }

  parseData(buffer: Buffer) {
    this.data = buffer;
  }
}

export class IndexData extends Record {
  static opcode = 4;
  ver: number;
  conn: number;
  count: number;
  indices: Array<{ time: Time, offset: number }>;

  constructor(fields: { [key: string]: Buffer }) {
    super(fields);
    this.ver = fields.ver.readUInt32LE(0);
    this.conn = fields.conn.readUInt32LE(0);
    this.count = fields.count.readUInt32LE(0);
  }

  parseData(buffer: Buffer) {
    this.indices = [];
    for (let i = 0; i < this.count; i++) {
      this.indices.push({
        time: extractTime(buffer, i * 12),
        offset: buffer.readUInt32LE(i * 12 + 8),
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

  constructor(fields: { [key: string]: Buffer }) {
    super(fields);
    this.ver = fields.ver.readUInt32LE(0);
    this.chunkPosition = readUInt64LE(fields.chunk_pos);
    this.startTime = extractTime(fields.start_time, 0);
    this.endTime = extractTime(fields.end_time, 0);
    this.count = fields.count.readUInt32LE(0);
  }

  parseData(buffer: Buffer) {
    this.connections = [];
    for (let i = 0; i < this.count; i++) {
      this.connections.push({
        conn: buffer.readUInt32LE(i * 8),
        count: buffer.readUInt32LE(i * 8 + 4),
      });
    }
  }
}
