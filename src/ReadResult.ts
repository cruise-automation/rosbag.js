// Copyright 2018-2020 Cruise LLC
// Copyright 2021 Foxglove Technologies Inc
//
// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { Time } from "@foxglove/rostime";

// represents a result passed to the callback from the high-level call:
// bag.readMessages({ opts: any }, callback: (ReadResult) => void) => Promise<void>
export default class ReadResult<T> {
  topic: string;
  message: T;
  timestamp: Time;
  data: Buffer;
  chunkOffset: number;
  totalChunks: number;

  constructor(
    topic: string,
    message: T,
    timestamp: Time,
    data: Buffer,
    chunkOffset: number,
    totalChunks: number,
    freeze?: boolean | null | undefined
  ) {
    // string: the topic the message was on
    this.topic = topic;

    // any: the parsed body of the message based on connection.messageDefinition
    this.message = message;

    // time: the timestamp of the message
    this.timestamp = timestamp;

    // buffer: raw buffer data of the message
    this.data = data;

    // the offset of the currently read chunk
    this.chunkOffset = chunkOffset;

    // the total number of chunks in the read operation
    this.totalChunks = totalChunks;

    if (freeze === true) {
      Object.freeze(timestamp);
      Object.freeze(this);
    }
  }
}
