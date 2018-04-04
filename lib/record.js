// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import int53 from "int53";

import { extractFields, extractTime } from "./fields";

const readUInt64LE = (buffer) => {
  return int53.readUInt64LE(buffer, 0);
};

class Record {
  constructor() {
    this.offset = undefined;
    this.dataOffset = undefined;
    this.end = undefined;
    this.length = undefined;
  }

  parseData() {}
}

class BagHeader extends Record {
  constructor(fields) {
    super(fields);
    this.indexPosition = readUInt64LE(fields.index_pos);
    this.connectionCount = fields.conn_count.readInt16LE(0);
    this.chunkCount = fields.chunk_count.readInt16LE(0);
  }
}

class Chunk extends Record {
  constructor(fields) {
    super(fields);
    this.compression = fields.compression.toString();
    this.size = fields.size.readUInt32LE(0);
  }

  parseData(buffer) {
    this.data = buffer;
  }
}

const getField = (fields, key) => {
  if (fields[key] === undefined) {
    throw new Error(`Connection header is missing ${key}.`);
  }
  return fields[key].toString();
};

class Connection extends Record {
  constructor(fields) {
    super(fields);
    this.conn = fields.conn.readUInt32LE(0);
    this.topic = fields.topic.toString();
    this.type = undefined;
    this.md5sum = undefined;
    this.messageDefinition = undefined;
  }

  parseData(buffer) {
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

class MessageData extends Record {
  constructor(fields) {
    super(fields);
    this.conn = fields.conn.readUInt32LE(0);
    this.time = extractTime(fields.time, 0);
  }

  parseData(buffer) {
    this.data = buffer;
  }
}

class IndexData extends Record {
  constructor(fields) {
    super(fields);
    this.ver = fields.ver.readUInt32LE(0);
    this.conn = fields.conn.readUInt32LE(0);
    this.count = fields.count.readUInt32LE(0);
  }

  parseData(buffer) {
    this.indices = [];
    for (let i = 0; i < this.count; i++) {
      this.indices.push({
        time: extractTime(buffer, i * 12),
        offset: buffer.readUInt32LE(i * 12 + 8),
      });
    }
  }
}

class ChunkInfo extends Record {
  constructor(fields) {
    super(fields);
    this.ver = fields.ver.readUInt32LE(0);
    this.chunkPosition = readUInt64LE(fields.chunk_pos);
    this.startTime = extractTime(fields.start_time, 0);
    this.endTime = extractTime(fields.end_time, 0);
    this.count = fields.count.readUInt32LE(0);
  }

  parseData(buffer) {
    this.connections = [];
    for (let i = 0; i < this.count; i++) {
      this.connections.push({
        conn: buffer.readUInt32LE(i * 8),
        count: buffer.readUInt32LE(i * 8 + 4),
      });
    }
  }
}

export { Record, BagHeader, Chunk, MessageData, IndexData, Connection, ChunkInfo };
