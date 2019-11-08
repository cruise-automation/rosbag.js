// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import type { Time, Callback, Filelike } from "./types";

import { parseHeader } from "./header";
import nmerge from "./nmerge";
import { Record, BagHeader, Chunk, ChunkInfo, Connection, IndexData, MessageData } from "./record";
import * as TimeUtil from "./TimeUtil";

interface ChunkReadResult {
  chunk: Chunk;
  indices: IndexData[];
}

export type Decompress = {
  [compression: string]: (buffer: Buffer, size: number) => Buffer,
};

const HEADER_READAHEAD = 4096;
const HEADER_OFFSET = 13;

// BagReader is a lower level interface for reading specific sections & chunks
// from a rosbag file - generally it is consumed through the Bag class, but
// can be useful to use directly for efficiently accessing raw pieces from
// within the bag
export default class BagReader {
  _lastReadResult: ChunkReadResult;
  _file: Filelike;
  _lastChunkInfo: ?ChunkInfo;

  constructor(filelike: Filelike) {
    this._file = filelike;
    this._lastChunkInfo = undefined;
  }

  verifyBagHeader(callback: Callback<BagHeader>, next: () => void) {
    this._file.read(0, HEADER_OFFSET, (error: Error | null, buffer?: Buffer) => {
      if (error || !buffer) {
        return callback(error || new Error("Missing both error and buffer"));
      }

      if (this._file.size() < HEADER_OFFSET) {
        return callback(new Error("Missing file header."));
      }

      if (buffer.toString() !== "#ROSBAG V2.0\n") {
        return callback(new Error("Cannot identify bag format."));
      }
      next();
    });
  }

  // reads the header block from the rosbag file
  // generally you call this first
  // because you need the header information to call readConnectionsAndChunkInfo
  readHeader(callback: Callback<BagHeader>) {
    this.verifyBagHeader(callback, () => {
      return this._file.read(HEADER_OFFSET, HEADER_READAHEAD, (error: Error | null, buffer?: Buffer) => {
        if (error || !buffer) {
          return callback(error || new Error("Missing both error and buffer"));
        }

        const read = buffer.length;
        if (read < 8) {
          return callback(new Error(`Record at position ${HEADER_OFFSET} is truncated.`));
        }

        const headerLength = buffer.readInt32LE(0);
        if (read < headerLength + 8) {
          return callback(new Error(`Record at position ${HEADER_OFFSET} header too large: ${headerLength}.`));
        }
        try {
          const header = this.readRecordFromBuffer(buffer, HEADER_OFFSET, BagHeader);
          return callback(null, header);
        } catch (e) {
          return callback(new Error(`Could not read header from rosbag file buffer - ${e.message}`));
        }
      });
    });
  }

  // promisified version of readHeader
  readHeaderAsync(): Promise<BagHeader> {
    return new Promise((resolve, reject) =>
      this.readHeader((err: Error | null, header?: BagHeader) => (err || !header ? reject(err) : resolve(header)))
    );
  }

  // reads connection and chunk information from the bag
  // you'll generally call this after reading the header so you can get
  // connection metadata and chunkInfos which allow you to seek to individual
  // chunks & read them
  readConnectionsAndChunkInfo(
    fileOffset: number,
    connectionCount: number,
    chunkCount: number,
    callback: Callback<{ connections: Connection[], chunkInfos: ChunkInfo[] }>
  ) {
    this._file.read(fileOffset, this._file.size() - fileOffset, (err: Error | null, buffer?: Buffer) => {
      if (err || !buffer) {
        return callback(err || new Error("Missing both error and buffer"));
      }

      if (connectionCount === 0) {
        return callback(null, { connections: [], chunkInfos: [] });
      }

      const connections = this.readRecordsFromBuffer(buffer, connectionCount, fileOffset, Connection);
      const connectionBlockLength = connections[connectionCount - 1].end - connections[0].offset;
      const chunkInfos = this.readRecordsFromBuffer(
        buffer.slice(connectionBlockLength),
        chunkCount,
        fileOffset + connectionBlockLength,
        ChunkInfo
      );

      if (chunkCount > 0) {
        for (let i = 0; i < chunkCount - 1; i++) {
          chunkInfos[i].nextChunk = chunkInfos[i + 1];
        }
        chunkInfos[chunkCount - 1].nextChunk = null;
      }

      return callback(null, { connections, chunkInfos });
    });
  }

  // promisified version of readConnectionsAndChunkInfo
  readConnectionsAndChunkInfoAsync(
    fileOffset: number,
    connectionCount: number,
    chunkCount: number
  ): Promise<{ connections: Connection[], chunkInfos: ChunkInfo[] }> {
    return new Promise((resolve, reject) => {
      this.readConnectionsAndChunkInfo(
        fileOffset,
        connectionCount,
        chunkCount,
        (err: Error | null, result?: { connections: Connection[], chunkInfos: ChunkInfo[] }) =>
          err || !result ? reject(err) : resolve(result)
      );
    });
  }

  // read individual raw messages from the bag at a given chunk
  // filters to a specific set of connection ids, start time, & end time
  // generally the records will be of type MessageData
  readChunkMessages(
    chunkInfo: ChunkInfo,
    connections: number[],
    startTime: Time | null,
    endTime: Time | null,
    decompress: Decompress,
    callback: Callback<MessageData[]>
  ) {
    const start = startTime || { sec: 0, nsec: 0 };
    const end = endTime || { sec: Number.MAX_VALUE, nsec: Number.MAX_VALUE };
    const conns =
      connections ||
      chunkInfo.connections.map((connection) => {
        return connection.conn;
      });

    this.readChunk(chunkInfo, decompress, (error: Error | null, result?: ChunkReadResult) => {
      if (error || !result) {
        return callback(error || new Error("Missing both error and result"));
      }

      const chunk = result.chunk;
      const indices: { [conn: number]: IndexData } = {};
      result.indices.forEach((index) => {
        indices[index.conn] = index;
      });
      const presentConnections = conns.filter((conn) => {
        return indices[conn] !== undefined;
      });
      const iterables = presentConnections.map((conn) => {
        // $FlowFixMe https://github.com/facebook/flow/issues/1163
        return indices[conn].indices[Symbol.iterator]();
      });
      const iter = nmerge((a, b) => TimeUtil.compare(a.time, b.time), ...iterables);

      const entries = [];
      let item = iter.next();
      while (!item.done) {
        const { value } = item;
        item = iter.next();
        if (!value || TimeUtil.isGreaterThan(start, value.time)) {
          continue;
        }
        if (TimeUtil.isGreaterThan(value.time, end)) {
          break;
        }
        entries.push(value);
      }

      const messages = entries.map((entry) => {
        return this.readRecordFromBuffer(chunk.data.slice(entry.offset), chunk.dataOffset, MessageData);
      });

      return callback(null, messages);
    });
  }

  // promisified version of readChunkMessages
  readChunkMessagesAsync(
    chunkInfo: ChunkInfo,
    connections: number[],
    startTime: Time,
    endTime: Time,
    decompress: Decompress
  ): Promise<MessageData[]> {
    return new Promise((resolve, reject) => {
      this.readChunkMessages(
        chunkInfo,
        connections,
        startTime,
        endTime,
        decompress,
        (err: Error | null, messages?: MessageData[]) => (err || !messages ? reject(err) : resolve(messages))
      );
    });
  }

  // reads a single chunk record && its index records given a chunkInfo
  readChunk(chunkInfo: ChunkInfo, decompress: Decompress, callback: Callback<ChunkReadResult>) {
    // if we're reading the same chunk a second time return the cached version
    // to avoid doing decompression on the same chunk multiple times which is
    // expensive
    if (chunkInfo === this._lastChunkInfo && this._lastReadResult) {
      // always callback async, even if we have the result
      // https://oren.github.io/blog/zalgo.html
      const lastReadResult = this._lastReadResult;
      return setImmediate(() => callback(null, lastReadResult));
    }
    const { nextChunk } = chunkInfo;

    const readLength = nextChunk
      ? nextChunk.chunkPosition - chunkInfo.chunkPosition
      : this._file.size() - chunkInfo.chunkPosition;

    this._file.read(chunkInfo.chunkPosition, readLength, (err: Error | null, buffer?: Buffer) => {
      if (err || !buffer) {
        return callback(err || new Error("Missing both error and buffer"));
      }

      const chunk = this.readRecordFromBuffer(buffer, chunkInfo.chunkPosition, Chunk);
      const { compression } = chunk;
      if (compression !== "none") {
        const decompressFn = decompress[compression];
        if (!decompressFn) {
          return callback(new Error(`Unsupported compression type ${chunk.compression}`));
        }
        const result = decompressFn(chunk.data, chunk.size);
        chunk.data = result;
      }
      const indices = this.readRecordsFromBuffer(
        buffer.slice(chunk.length),
        chunkInfo.count,
        chunkInfo.chunkPosition + chunk.length,
        IndexData
      );

      this._lastChunkInfo = chunkInfo;
      this._lastReadResult = { chunk, indices };
      return callback(null, this._lastReadResult);
    });
  }

  // reads count records from a buffer starting at fileOffset
  readRecordsFromBuffer<T: Record>(
    buffer: Buffer,
    count: number,
    fileOffset: number,
    cls: Class<T> & { opcode: number }
  ): T[] {
    const records = [];
    let bufferOffset = 0;
    for (let i = 0; i < count; i++) {
      const record = this.readRecordFromBuffer(buffer.slice(bufferOffset), fileOffset + bufferOffset, cls);
      bufferOffset += record.end - record.offset;
      records.push(record);
    }
    return records;
  }

  // read an individual record from a buffer
  readRecordFromBuffer<T: Record>(buffer: Buffer, fileOffset: number, cls: Class<T> & { opcode: number }): T {
    const headerLength = buffer.readInt32LE(0);
    const record = parseHeader(buffer.slice(4, 4 + headerLength), cls);

    const dataOffset = 4 + headerLength + 4;
    const dataLength = buffer.readInt32LE(4 + headerLength);
    const data = buffer.slice(dataOffset, dataOffset + dataLength);

    record.parseData(data);

    record.offset = fileOffset;
    record.dataOffset = record.offset + 4 + headerLength + 4;
    record.end = record.dataOffset + dataLength;
    record.length = record.end - record.offset;

    return record;
  }
}
