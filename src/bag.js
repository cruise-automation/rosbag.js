// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import BagReader, { type Decompress } from "./BagReader";
import { MessageReader } from "./MessageReader";
import ReadResult from "./ReadResult";
import { BagHeader, ChunkInfo, Connection, MessageData } from "./record";
import type { Time } from "./types";
import * as TimeUtil from "./TimeUtil";

export type ReadOptions = {|
  decompress?: Decompress,
  noParse?: boolean,
  topics?: string[],
  startTime?: Time,
  endTime?: Time,
  maxBytes?: number,
|};

// the high level rosbag interface
// create a new bag by calling:
// `const bag = await Bag.open('./path-to-file.bag')` in node or
// `const bag = await Bag.open(files[0])` in the browser
//
// after that you can consume messages by calling
// `await bag.readMessages({ topics: ['/foo'] },
//    (result) => console.log(result.topic, result.message))`
export default class Bag {
  reader: BagReader;
  header: BagHeader;
  connections: { [conn: number]: Connection };
  chunkInfos: ChunkInfo[];
  startTime: ?Time;
  endTime: ?Time;

  // you can optionally create a bag manually passing in a bagReader instance
  constructor(bagReader: BagReader) {
    this.reader = bagReader;
  }

  // eslint-disable-next-line no-unused-vars
  static open = (file: File | string) => {
    throw new Error(
      "This method should have been overridden based on the environment. Make sure you are correctly importing the node or web version of Bag."
    );
  };

  // if the bag is manually created with the constructor, you must call `await open()` on the bag
  // generally this is called for you if you're using `const bag = await Bag.open()`
  async open() {
    this.header = await this.reader.readHeaderAsync();
    const { connectionCount, chunkCount, indexPosition } = this.header;

    const result = await this.reader.readConnectionsAndChunkInfoAsync(indexPosition, connectionCount, chunkCount);

    this.connections = {};

    result.connections.forEach((connection) => {
      this.connections[connection.conn] = connection;
    });

    this.chunkInfos = result.chunkInfos;

    if (chunkCount > 0) {
      this.startTime = this.chunkInfos[0].startTime;
      this.endTime = this.chunkInfos[chunkCount - 1].endTime;
    }
  }

  async readMessages(opts: ReadOptions, callback: (msg: ReadResult<any>) => void) {
    const connections = this.connections;

    const startTime = opts.startTime || { sec: 0, nsec: 0 };
    const endTime = opts.endTime || { sec: Number.MAX_VALUE, nsec: Number.MAX_VALUE };
    const topics =
      opts.topics ||
      Object.keys(connections).map((id: any) => {
        return connections[id].topic;
      });

    const filteredConnections = Object.keys(connections)
      .filter((id: any) => {
        return topics.indexOf(connections[id].topic) !== -1;
      })
      .map((id) => +id);

    const { decompress = {}, maxBytes = 0 } = opts;

    // filter chunks to those which fall within the time range we're attempting to read
    const chunkInfos = this.chunkInfos.filter((info) => {
      return TimeUtil.compare(info.startTime, endTime) <= 0 && TimeUtil.compare(startTime, info.endTime) <= 0;
    });

    function parseMsg(msg: MessageData, chunkOffset: number): ReadResult<any> {
      const connection = connections[msg.conn];
      const { topic } = connection;
      const { data, time: timestamp } = msg;
      let message = null;
      if (!opts.noParse) {
        // lazily create a reader for this connection if it doesn't exist
        connection.reader = connection.reader || new MessageReader(connection.messageDefinition);
        message = connection.reader.readMessage(data);
      }
      return new ReadResult(topic, message, timestamp, data, chunkOffset, chunkInfos.length);
    }

    // Process the list of chunks such that no more than a maximum amount of bytes are being used and at
    // least one chunk is processed at a time
    function* processChunks(chunkInfos, processedCb) {
      const messageArray = new Array(chunkInfos.length).fill();
      let nextIndex = 0;
      let activeBytesProcessing = 0;
      let activeProcessing = 0;
      for (let i = 0, l = chunkInfos.length; i < l; i++) {

        const index = i;
        const info = chunkInfos[i];
        const { nextChunk } = info;
        const chunkSize = nextChunk
          ? nextChunk.chunkPosition - info.chunkPosition
          : this.reader._file.size() - info.chunkPosition;

        // Wait until other chunks have finished processing
        while (activeProcessing !== 0 && activeBytesProcessing + chunkSize > maxBytes ) yield;

        activeProcessing++;
        activeBytesProcessing += chunkSize;
        const promise = this.reader.readChunkMessagesAsync(
          info,
          filteredConnections,
          startTime,
          endTime,
          decompress,
          i === l - 1 // cache the chunk if it's the last one
        );

        promise.then((messages) => {
          const info = {
            chunkSize,
            messages
          };

          messageArray[index] = info;

          // Process the messages in order if they're available to be processed
          while (messageArray[nextIndex]) {
            const nextMessages = messageArray[nextIndex];
            activeProcessing --;
            activeBytesProcessing -= nextMessages.chunkSize;

            processedCb(null, nextMessages.messages);
            messageArray[nextIndex] = null;
            nextIndex ++;
          }
        }).catch((err) => {
          processedCb(err);
        });
      }
    }

    if (chunkInfos.length === 0) {
      return;
    } else {
      await new Promise((resolve, reject) => {

        // Start the task for processing all the chunk data and try to process more
        // once a chunk has finished processing
        let totalResolved = 0;
        let rejected = false;
        const task = processChunks.call(this, chunkInfos, (err: Error | null, messages?: MessageData[]) => {
          // If we've already thrown an error then don't bother doing any more work.
          if (rejected) {
            return;
          }

          if (err || !messages) {
            rejected = true;
            reject(err || new Error("Missing both error and messages"));
          } else {
            messages.forEach((msg) => callback(parseMsg(msg, totalResolved)));
            totalResolved++;

            if (totalResolved === chunkInfos.length) {
              resolve();
            }

            task.next();
          }
        });
        task.next();
      });
    }
  }
}
