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

    const { decompress = {} } = opts;

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

    for (let i = 0; i < chunkInfos.length; i++) {
      const info = chunkInfos[i];
      const messages = await this.reader.readChunkMessagesAsync(
        info,
        filteredConnections,
        startTime,
        endTime,
        decompress
      );
      messages.forEach((msg) => callback(parseMsg(msg, i)));
    }
  }
}
