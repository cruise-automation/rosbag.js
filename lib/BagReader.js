// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { parseHeader } from "./header";
import Time from "./Time";
import nmerge from "./nmerge";

// BagReader is a lower level interface for reading specific sections & chunks
// from a rosbag file - generally it is consumed through the Bag class, but
// can be useful to use directly for efficiently accessing raw pieces from within the bag
export default class BagReader {
  constructor(filelike) {
    this.file = filelike;
    this._lastChunkInfo = undefined;
    this._lastReadResult = undefined;
  }

  // reads the header block from the rosbag file
  // generally you call this first
  // because you need the header information to call readConnectionsAndChunkInfo
  // the callback is in the form (err: Error?, header: BagHeader?) => void
  readHeader(callback) {
    const offset = 13;

    this.file.read(0, offset, (error, buffer) => {
      if (this.file.size() < offset) {
        return callback(new Error("Missing file header."));
      }

      if (error) {
        return callback(error);
      }

      if (buffer.toString() !== "#ROSBAG V2.0\n") {
        return callback(new Error("Cannot identify bag format."));
      }

      return this.file.read(offset, BagReader.HEADER_READAHEAD, (error, buffer) => {
        if (error) {
          return callback(error);
        }

        const read = buffer.length;
        if (read < 8) {
          return callback(new Error(`Record at position ${offset} is truncated.`));
        }

        const headerLength = buffer.readInt32LE(0);
        if (read < headerLength + 8) {
          return callback(new Error(`Record at position ${offset} header too large: ${headerLength}.`));
        }
        const header = this.readRecordFromBuffer(buffer, offset);
        return callback(null, header);
      });
    });
  }

  // promisified version of readHeader
  readHeaderAsync() {
    return new Promise((resolve, reject) => this.readHeader((err, header) => (err ? reject(err) : resolve(header))));
  }

  // reads connection and chunk information from the bag
  // you'll generally call this after reading the header so you can get connection metadata
  // and chunkInfos which allow you to seek to individual chunks & read them
  // the callback is in the form:
  // (err: Error?, response?: { connections: Array<Connection>, chunkInfos: Array<ChunkInfo> })
  readConnectionsAndChunkInfo(fileOffset, connectionCount, chunkCount, callback) {
    this.file.read(fileOffset, this.file.size() - fileOffset, (err, buffer) => {
      if (err) {
        return callback(err);
      }

      const connections = this.readRecordsFromBuffer(buffer, connectionCount, fileOffset);
      const connectionBlockLength = connections[connectionCount - 1].end - connections[0].offset;
      const chunkInfos = this.readRecordsFromBuffer(
        buffer.slice(connectionBlockLength),
        chunkCount,
        fileOffset + connectionBlockLength
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
  readConnectionsAndChunkInfoAsync(fileOffset, connectionCount, chunkCount) {
    return new Promise((resolve, reject) => {
      this.readConnectionsAndChunkInfo(
        fileOffset,
        connectionCount,
        chunkCount,
        (err, result) => (err ? reject(err) : resolve(result))
      );
    });
  }

  // read individual raw messages from the bag at a given chunk
  // filters to a specific set of connection ids, start time, & end time
  // the callback is in the form (err: Error?, response?: Array<Record>)
  // generally the records will be of type MessageData
  readChunkMessages(chunkInfo, connections, startTime, endTime, decompress, each, callback) {
    const start = startTime || new Time(0, 0);
    const end = endTime || new Time(Number.MAX_VALUE, Number.MAX_VALUE);
    const conns =
      connections ||
      chunkInfo.connections.map((connection) => {
        return connection.conn;
      });

    this.readChunk(chunkInfo, decompress, (error, result) => {
      if (error) {
        return callback(error);
      }

      const chunk = result.chunk;
      const indices = {};
      result.indices.forEach((index) => {
        indices[index.conn] = index;
      });
      const presentConnections = conns.filter((conn) => {
        return indices[conn] !== undefined;
      });
      const iterables = presentConnections.map((conn) => {
        return indices[conn].indices[Symbol.iterator]();
      });
      const iter = nmerge((a, b) => Time.compare(a.time, b.time), ...iterables);

      const entries = [];
      let item = iter.next();
      while (!item.done) {
        const { value } = item;
        item = iter.next();
        if (Time.isGreaterThan(start, value.time)) {
          continue;
        }
        if (Time.isGreaterThan(value.time, end)) {
          break;
        }
        entries.push(value);
      }

      const messages = entries.map((entry, i) => {
        const msg = this.readRecordFromBuffer(chunk.data.slice(entry.offset), chunk.dataOffset);
        return (each && each(msg, i)) || msg;
      });

      return callback(null, messages);
    });
  }

  // promisified version of readChunkMessages
  readChunkMessagesAsync(chunkInfo, connections, startTime, endTime, decompress, each) {
    return new Promise((resolve, reject) => {
      this.readChunkMessages(
        chunkInfo,
        connections,
        startTime,
        endTime,
        decompress,
        each,
        (err, messages) => (err ? reject(err) : resolve(messages))
      );
    });
  }

  // reads a single chunk record && its index records given a chunkInfo
  readChunk(chunkInfo, decompress, callback) {
    // if we're reading the same chunk a second time return the cached version
    // to avoid doing decompression on the same chunk multiple times which is expensive
    if (chunkInfo === this._lastChunkInfo) {
      // always callback async, even if we have the result
      // https://oren.github.io/blog/zalgo.html
      return setImmediate(() => callback(null, this._lastReadResult));
    }
    this._lastChunkInfo = chunkInfo;
    const { nextChunk } = chunkInfo;

    const readLength = nextChunk
      ? nextChunk.chunkPosition - chunkInfo.chunkPosition
      : this.file.size() - chunkInfo.chunkPosition;

    this.file.read(chunkInfo.chunkPosition, readLength, (err, buffer) => {
      if (err) {
        return callback(err);
      }

      const chunk = this.readRecordFromBuffer(buffer, chunkInfo.chunkPosition);
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
        chunkInfo.chunkPosition + chunk.length
      );

      this._lastReadResult = { chunk, indices };
      return callback(null, this._lastReadResult);
    });
  }

  // reads count records from a buffer starting at fileOffset
  readRecordsFromBuffer(buffer, count, fileOffset) {
    const records = [];
    let bufferOffset = 0;
    for (let i = 0; i < count; i++) {
      const record = this.readRecordFromBuffer(buffer.slice(bufferOffset), fileOffset + bufferOffset);
      bufferOffset += record.end - record.offset;
      records.push(record);
    }
    return records;
  }

  // read an individual record from a buffer
  readRecordFromBuffer(buffer, fileOffset) {
    const headerLength = buffer.readInt32LE(0);
    const record = parseHeader(buffer.slice(4, 4 + headerLength));
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

BagReader.HEADER_READAHEAD = 4096;
