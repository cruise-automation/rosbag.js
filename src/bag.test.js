// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import compress from "compressjs";
import fs from "fs";
import lz4 from "lz4js";

import type { ReadOptions } from "./bag";
import Bag from "./node";
import ReadResult from "./ReadResult";
import * as TimeUtil from "./TimeUtil";

const FILENAME = "example";

function getFixture(filename = FILENAME) {
  return `${__dirname}/../fixtures/${filename}.bag`;
}

async function fullyReadBag(name: string, opts?: ReadOptions): Promise<ReadResult<any>[]> {
  const filename = getFixture(name);
  expect(fs.existsSync(filename)).toBe(true);
  const bag = await Bag.open(filename);
  const messages = [];
  await bag.readMessages(opts || {}, (msg) => {
    messages.push(msg);
  });
  return messages;
}

describe("basics", () => {
  expect(Bag.open(getFixture("NON_EXISTENT_FILE"))).rejects.toThrow("no such file or directory");
  expect(Bag.open(getFixture("empty-file"))).rejects.toThrow("Missing file header.");
  expect(fullyReadBag("no-messages")).resolves.toEqual([]);
});

describe("rosbag - high-level api", () => {
  const testNumberOfMessages = (
    name: string,
    expected: number,
    opts: ReadOptions,
    done?: (messages: ReadResult<any>[]) => void
  ) => {
    it(`finds ${expected} messages in ${name} with ${JSON.stringify(opts)}`, async () => {
      const messages = await fullyReadBag(name, opts);
      expect(messages).toHaveLength(expected);
      if (expected) {
        const [message] = messages;
        expect(message).toBeDefined();
        expect(message.timestamp).toBeDefined();
      }
      if (done) {
        done(messages);
      }
    });
  };

  testNumberOfMessages(FILENAME, 8647, { startTime: { sec: -1, nsec: -1 } });
  testNumberOfMessages(FILENAME, 8647, { startTime: { sec: 0, nsec: 0 } });
  testNumberOfMessages(FILENAME, 1, {
    startTime: { sec: 1396293887, nsec: 846735850 },
    endTime: { sec: 1396293887, nsec: 846735850 },
  });
  testNumberOfMessages(FILENAME, 319, {
    startTime: { sec: 1396293886, nsec: 846735850 },
    endTime: { sec: 1396293888, nsec: 846735850 },
  });
  testNumberOfMessages(FILENAME, 0, { endTime: { sec: 0, nsec: 0 } });
  testNumberOfMessages(FILENAME, 0, { startTime: TimeUtil.fromDate(new Date()) });
  testNumberOfMessages(FILENAME, 0, { endTime: { sec: -1, nsec: -1 } });

  it("returns chunkOffset and totalChunks on read results", async () => {
    const filename = getFixture();
    const bag = await Bag.open(filename);
    const messages = [];
    await bag.readMessages({}, (msg) => {
      messages.push(msg);
    });
    expect(messages[0].chunkOffset).toBe(0);
    expect(messages[0].totalChunks).toBe(1);
  });

  it("reads topics", async () => {
    const bag = await Bag.open(getFixture());
    const topics = Object.keys(bag.connections).map((con: any) => bag.connections[con].topic);
    expect(topics).toEqual([
      "/rosout",
      "/turtle1/color_sensor",
      "/rosout",
      "/rosout",
      "/tf_static",
      "/turtle2/color_sensor",
      "/turtle1/pose",
      "/turtle2/pose",
      "/tf",
      "/tf",
      "/turtle2/cmd_vel",
      "/turtle1/cmd_vel",
    ]);
  });

  it("reads correct fields on /tf message", async () => {
    const messages = await fullyReadBag(FILENAME, { topics: ["/tf"] });
    expect(messages[0].message).toMatchSnapshot();
  });

  it("can read bag twice at once", async () => {
    const bag = await Bag.open(getFixture());
    const messages1 = [];
    const messages2 = [];
    const readPromise1 = bag.readMessages({ topics: ["/tf"] }, (msg) => {
      messages1.push(msg);
    });
    const readPromise2 = bag.readMessages({ topics: ["/tf"] }, (msg) => {
      messages2.push(msg);
    });
    await Promise.all([readPromise1, readPromise2]);
    expect(messages1).toEqual(messages2);
  });

  it("reads poses", async () => {
    const opts = { topics: ["/turtle1/cmd_vel"] };
    const messages = await fullyReadBag(FILENAME, opts);
    const [msg] = messages;
    const { linear } = msg.message;
    expect(msg.timestamp).toEqual({
      sec: 1396293889,
      nsec: 366115136,
    });
    expect(linear).toEqual({
      x: 2,
      y: 0,
      z: 0,
    });
  });

  it("reads messages filtered to a specific topic", async () => {
    const messages = await fullyReadBag(FILENAME, { topics: ["/turtle1/color_sensor"] });
    const topics = messages.map((msg) => msg.topic);
    expect(topics).toHaveLength(1351);
    topics.forEach((topic) => expect(topic).toBe("/turtle1/color_sensor"));
  });

  it("reads messages filtered to multiple topics", async () => {
    const opts = { topics: ["/turtle1/color_sensor", "/turtle2/color_sensor"] };
    const messages = await fullyReadBag(FILENAME, opts);
    const topics = messages.map((msg) => msg.topic);
    expect(topics).toHaveLength(2695);
    topics.forEach((topic) =>
      expect(topic === "/turtle1/color_sensor" || topic === "/turtle2/color_sensor").toBe(true)
    );
  });

  describe("compression", () => {
    it("throws if compression scheme is not registered", async () => {
      let errorThrown = false;
      const bag = await Bag.open(getFixture("example-bz2"));
      try {
        await bag.readMessages({}, () => {});
      } catch (e) {
        expect(e.message).toContain("compression");
        errorThrown = true;
      }
      expect(errorThrown).toBe(true);
    });

    it("reads bz2 with supplied decompression callback", async () => {
      const messages = await fullyReadBag("example-bz2", {
        topics: ["/turtle1/color_sensor"],
        decompress: {
          bz2: (buffer: Buffer) => {
            const arr = compress.Bzip2.decompressFile(buffer);
            return Buffer.from(arr);
          },
        },
      });
      const topics = messages.map((msg) => msg.topic);
      expect(topics).toHaveLength(1351);
      topics.forEach((topic) => expect(topic).toBe("/turtle1/color_sensor"));
    });

    it("reads lz4 with supplied decompression callback", async () => {
      const messages = await fullyReadBag("example-lz4", {
        topics: ["/turtle1/color_sensor"],
        decompress: {
          lz4: (buffer: Buffer) => new Buffer(lz4.decompress(buffer)),
        },
      });
      const topics = messages.map((msg) => msg.topic);
      expect(topics).toHaveLength(1351);
      topics.forEach((topic) => expect(topic).toBe("/turtle1/color_sensor"));
    });

    it("calls decompress with the chunk size", async () => {
      await fullyReadBag("example-lz4", {
        startTime: { sec: 1396293887, nsec: 846735850 },
        endTime: { sec: 1396293887, nsec: 846735850 },
        topics: ["/turtle1/color_sensor"],
        decompress: {
          lz4: (buffer: Buffer, size: number) => {
            expect(size).toBe(743449);
            const buff = new Buffer(lz4.decompress(buffer));
            expect(buff.byteLength).toBe(size);
            return buff;
          },
        },
      });
    });
  });
});
