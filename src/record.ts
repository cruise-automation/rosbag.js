// Copyright 2018-2020 Cruise LLC
// Copyright 2021 Foxglove Technologies Inc
//
// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { MessageReader } from "@foxglove/rosmsg-serialization";
import { Time } from "@foxglove/rostime";

import { extractFields, extractTime } from "./fields";

export class Record {
  offset?: number;
  dataOffset?: number;
  end?: number;
  length?: number;

  parseData(_buffer: Buffer): void {
    /* no-op */
  }
}

export class BagHeader extends Record {
  static opcode = 3;
  indexPosition: number;
  connectionCount: number;
  chunkCount: number;

  constructor(fields: { [key: string]: Buffer }) {
    super();
    this.indexPosition = Number(fields.index_pos!.readBigUInt64LE(0));
    this.connectionCount = fields.conn_count!.readInt32LE(0);
    this.chunkCount = fields.chunk_count!.readInt32LE(0);
  }
}

export class Chunk extends Record {
  static opcode = 5;
  compression: string;
  size: number;
  data?: Buffer;

  constructor(fields: { [key: string]: Buffer }) {
    super();
    this.compression = fields.compression!.toString();
    this.size = fields.size!.readUInt32LE(0);
  }

  override parseData(buffer: Buffer): void {
    this.data = buffer;
  }
}

const getField = (
  fields: {
    [key: string]: Buffer;
  },
  key: string
) => {
  if (fields[key] == undefined) {
    throw new Error(`Connection header is missing ${key}.`);
  }
  return fields[key]!.toString();
};

export class Connection extends Record {
  static opcode = 7;
  conn: number;
  topic: string;
  type: string | null | undefined;
  md5sum: string | null | undefined;
  messageDefinition: string;
  callerid: string | null | undefined;
  latching: boolean | null | undefined;
  reader: MessageReader | null | undefined;

  constructor(fields: { [key: string]: Buffer }) {
    super();
    this.conn = fields.conn!.readUInt32LE(0);
    this.topic = fields.topic!.toString();
    this.type = undefined;
    this.md5sum = undefined;
    this.messageDefinition = "";
  }

  override parseData(buffer: Buffer): void {
    const fields = extractFields(buffer);
    this.type = getField(fields, "type");
    this.md5sum = getField(fields, "md5sum");
    this.messageDefinition = getField(fields, "message_definition");
    if (fields.callerid != undefined) {
      this.callerid = fields.callerid.toString();
    }
    if (fields.latching != undefined) {
      this.latching = fields.latching.toString() === "1";
    }
  }
}

export class MessageData extends Record {
  static opcode = 2;
  conn: number;
  time: Time;
  data?: Buffer;

  constructor(fields: { [key: string]: Buffer }) {
    super();
    this.conn = fields.conn!.readUInt32LE(0);
    this.time = extractTime(fields.time!, 0);
  }

  override parseData(buffer: Buffer): void {
    this.data = buffer;
  }
}

export class IndexData extends Record {
  static opcode = 4;
  ver: number;
  conn: number;
  count: number;
  indices?: Array<{ time: Time; offset: number }>;

  constructor(fields: { [key: string]: Buffer }) {
    super();
    this.ver = fields.ver!.readUInt32LE(0);
    this.conn = fields.conn!.readUInt32LE(0);
    this.count = fields.count!.readUInt32LE(0);
  }

  override parseData(buffer: Buffer): void {
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
  connections: Array<{ conn: number; count: number }> = [];
  nextChunk: ChunkInfo | null | undefined;

  constructor(fields: { [key: string]: Buffer }) {
    super();
    this.ver = fields.ver!.readUInt32LE(0);
    this.chunkPosition = Number(fields.chunk_pos!.readBigUInt64LE(0));
    this.startTime = extractTime(fields.start_time!, 0);
    this.endTime = extractTime(fields.end_time!, 0);
    this.count = fields.count!.readUInt32LE(0);
  }

  override parseData(buffer: Buffer): void {
    this.connections = [];
    for (let i = 0; i < this.count; i++) {
      this.connections.push({
        conn: buffer.readUInt32LE(i * 8),
        count: buffer.readUInt32LE(i * 8 + 4),
      });
    }
  }
}
