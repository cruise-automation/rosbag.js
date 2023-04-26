// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import type { Decompress } from "./BagReader";
import BagReader from "./BagReader";
import { MessageReader } from "./MessageReader";
import ReadResult from "./ReadResult";
import { BagHeader, ChunkInfo, Connection, MessageData } from "./record";
import type { Time } from "./types";
import * as TimeUtil from "./TimeUtil";
import { parseMessageDefinition } from "./parseMessageDefinition";

export type ReadOptions = {
  decompress?: Decompress;
  noParse?: boolean;
  topics?: string[];
  startTime?: Time;
  endTime?: Time;
  freeze?: boolean;
};

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
  header?: BagHeader;
  connections?: Record<number, Connection>;
  chunkInfos?: ChunkInfo[];
  startTime?: Time;
  endTime?: Time;

  // you can optionally create a bag manually passing in a bagReader instance
  constructor(bagReader: BagReader) {
    this.reader = bagReader;
  }

  static open = (_file: File | string): Promise<Bag> =>
    Promise.reject(
      new Error(
        "This method should have been overridden based on the environment. Make sure you are correctly importing the node or web version of Bag."
      )
    );

  // eslint-disable-next-line no-use-before-define
  private assertOpen(): asserts this is OpenBag {
    if (!this.header || !this.connections || !this.chunkInfos) {
      throw new Error("Bag needs to be opened");
    }
  }

  // if the bag is manually created with the constructor, you must call `await open()` on the bag
  // generally this is called for you if you're using `const bag = await Bag.open()`
  async open() {
    this.header = await this.reader.readHeaderAsync();
    const { connectionCount, chunkCount, indexPosition } = this.header;

    const result = await this.reader.readConnectionsAndChunkInfoAsync(indexPosition, connectionCount, chunkCount);

    this.connections = {};
    result.connections.forEach((connection) => {
      // Connections is definitly assigned above
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.connections![connection.conn] = connection;
    });

    this.chunkInfos = result.chunkInfos;

    if (chunkCount > 0) {
      // Get the earliest startTime among all chunks
      this.startTime = this.chunkInfos
        .map((x) => x.startTime)
        .reduce((prev, current) => (TimeUtil.compare(prev, current) <= 0 ? prev : current));
      // Get the latest endTime among all chunks
      this.endTime = this.chunkInfos
        .map((x) => x.endTime)
        .reduce((prev, current) => (TimeUtil.compare(prev, current) > 0 ? prev : current));
    }
  }

  async readMessages(opts: ReadOptions, callback: (msg: ReadResult<unknown>) => void) {
    this.assertOpen();

    const { connections } = this;
    const startTime = opts.startTime || {
      sec: 0,
      nsec: 0,
    };
    const endTime = opts.endTime || {
      sec: Number.MAX_VALUE,
      nsec: Number.MAX_VALUE,
    };
    const topics = opts.topics || Object.values(connections).map((connection) => connection.topic);

    const filteredConnections = Object.values(connections)
      .filter((connection) => topics.indexOf(connection.topic) !== -1)
      .map((connection) => +connection.conn);

    const { decompress = {} } = opts;

    // filter chunks to those which fall within the time range we're attempting to read
    const chunkInfos = this.chunkInfos.filter(
      (info) => TimeUtil.compare(info.startTime, endTime) <= 0 && TimeUtil.compare(startTime, info.endTime) <= 0
    );

    function parseMsg(msg: MessageData, chunkOffset: number): ReadResult<unknown> {
      const connection = connections[msg.conn];
      const { topic, type } = connection;
      const { data, time: timestamp } = msg;
      let message = null;

      if (!opts.noParse) {
        // lazily create a reader for this connection if it doesn't exist
        connection.reader =
          connection.reader ||
          new MessageReader(parseMessageDefinition(connection.messageDefinition, type), type, {
            freeze: opts.freeze,
          });
        message = connection.reader.readMessage(data);
      }

      return new ReadResult(topic, message, timestamp, data, chunkOffset, chunkInfos.length, opts.freeze);
    }

    for (let i = 0; i < chunkInfos.length; i++) {
      const info = chunkInfos[i];
      // eslint-disable-next-line no-await-in-loop
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

interface OpenBag extends Bag {
  header: BagHeader;
  connections: Record<number, Connection>;
  chunkInfos: ChunkInfo[];
}
