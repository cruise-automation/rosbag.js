// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import int53 from "int53";
import { extractFields, extractTime } from "./fields";
import { MessageReader } from "./MessageReader";
import type { Time } from "./types";

const readUInt64LE = (buffer: Buffer) => int53.readUInt64LE(buffer, 0);

export class RosbagRecord {
  offset: number;
  dataOffset: number;
  end: number;
  length: number;
}

export interface RosbagRecordConstructor<T extends RosbagRecord> {
  opcode: number;
  new (fields: Record<string, any>, buffer: Buffer): T;
}

export class BagHeader extends RosbagRecord {
  static opcode = 3;
  indexPosition: number;
  connectionCount: number;
  chunkCount: number;

  constructor(fields: Record<string, Buffer>, _buffer: Buffer) {
    super();
    this.indexPosition = readUInt64LE(fields.index_pos);
    this.connectionCount = fields.conn_count.readInt32LE(0);
    this.chunkCount = fields.chunk_count.readInt32LE(0);
  }
}

export class Chunk extends RosbagRecord {
  static opcode = 5;
  compression: string;
  size: number;
  data: Buffer;

  constructor(fields: Record<string, Buffer>, buffer: Buffer) {
    super();
    this.compression = fields.compression.toString();
    this.size = fields.size.readUInt32LE(0);
    this.data = buffer;
  }
}

const getField = (fields: Record<string, Buffer>, key: string) => {
  if (fields[key] === undefined) {
    throw new Error(`Connection header is missing ${key}.`);
  }

  return fields[key].toString();
};

export class Connection extends RosbagRecord {
  static opcode = 7;
  conn: number;
  topic: string;
  type: string;
  md5sum: string;
  messageDefinition: string;
  callerid?: string;
  latching?: boolean;
  reader?: MessageReader;

  constructor(fields: Record<string, Buffer>, buffer: Buffer) {
    super();
    this.conn = fields.conn.readUInt32LE(0);
    this.topic = fields.topic.toString();
    this.messageDefinition = "";
    const bufferFields = extractFields(buffer);
    this.type = getField(bufferFields, "type");
    this.md5sum = getField(bufferFields, "md5sum");
    this.messageDefinition = getField(bufferFields, "message_definition");

    if (bufferFields.callerid !== undefined) {
      this.callerid = bufferFields.callerid.toString();
    }

    if (bufferFields.latching !== undefined) {
      this.latching = bufferFields.latching.toString() === "1";
    }
  }
}

export class MessageData extends RosbagRecord {
  static opcode = 2;
  conn: number;
  time: Time;
  data: Buffer;

  constructor(fields: Record<string, Buffer>, buffer: Buffer) {
    super();
    this.conn = fields.conn.readUInt32LE(0);
    this.time = extractTime(fields.time, 0);
    this.data = buffer;
  }
}

export class IndexData extends RosbagRecord {
  static opcode = 4;
  ver: number;
  conn: number;
  count: number;
  indices: Array<{
    time: Time;
    offset: number;
  }>;

  constructor(fields: Record<string, Buffer>, buffer: Buffer) {
    super();
    this.ver = fields.ver.readUInt32LE(0);
    this.conn = fields.conn.readUInt32LE(0);
    this.count = fields.count.readUInt32LE(0);
    this.indices = [];

    for (let i = 0; i < this.count; i++) {
      this.indices.push({
        time: extractTime(buffer, i * 12),
        offset: buffer.readUInt32LE(i * 12 + 8),
      });
    }
  }
}

// Classes can't reference their own type (in `nextChunk`) but interfaces can, so this is split out.
export interface ChunkInfoInterface {
  ver: number;
  chunkPosition: number;
  startTime: Time;
  endTime: Time;
  count: number;
  connections: {
    conn: number;
    count: number;
  }[];
  nextChunk?: ChunkInfoInterface;
}

export class ChunkInfo extends RosbagRecord implements ChunkInfoInterface {
  static opcode = 6;
  ver: number;
  chunkPosition: number;
  startTime: Time;
  endTime: Time;
  count: number;
  connections: {
    conn: number;
    count: number;
  }[];
  nextChunk?: ChunkInfoInterface;

  constructor(fields: Record<string, Buffer>, buffer: Buffer) {
    super();
    this.ver = fields.ver.readUInt32LE(0);
    this.chunkPosition = readUInt64LE(fields.chunk_pos);
    this.startTime = extractTime(fields.start_time, 0);
    this.endTime = extractTime(fields.end_time, 0);
    this.count = fields.count.readUInt32LE(0);
    this.connections = [];

    for (let i = 0; i < this.count; i++) {
      this.connections.push({
        conn: buffer.readUInt32LE(i * 8),
        count: buffer.readUInt32LE(i * 8 + 4),
      });
    }
  }
}
