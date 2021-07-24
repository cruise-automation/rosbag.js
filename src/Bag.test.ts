// Copyright 2018-2020 Cruise LLC
// Copyright 2021 Foxglove Technologies Inc
//
// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

/* eslint-disable jest/no-conditional-expect */

import { compare, fromDate } from "@foxglove/rostime";
import compress from "compressjs";
import fs from "fs";
import lz4 from "lz4js";

import { ReadOptions } from "./Bag";
import ReadResult from "./ReadResult";
import Bag from "./node";

const FILENAME = "example";

type LinearMessage = { linear: { x: number; y: number; z: number } };

function getFixture(filename = FILENAME): string {
  return `${__dirname}/../fixtures/${filename}.bag`;
}

async function fullyReadBag<T>(name: string, opts?: ReadOptions): Promise<ReadResult<T>[]> {
  const filename = getFixture(name);
  expect(fs.existsSync(filename)).toBe(true);
  const bag = await Bag.open(filename);
  const messages: ReadResult<T>[] = [];
  await bag.readMessages<T>(opts ?? {}, (msg) => {
    messages.push(msg);
  });
  return messages;
}

describe("basics", () => {
  it("handles empty and non-existent bags", async () => {
    await expect(Bag.open(getFixture("NON_EXISTENT_FILE"))).rejects.toThrow("no such file or directory");
    await expect(Bag.open(getFixture("empty-file"))).rejects.toThrow("Missing file header.");
    await expect(fullyReadBag("no-messages")).resolves.toEqual([]);
  });
});

describe("rosbag - high-level api", () => {
  const testNumberOfMessages = (
    name: string,
    expected: number,
    opts: ReadOptions,
    done?: (messages: ReadResult<unknown>[]) => void
  ) => {
    it(`finds ${expected} messages in ${name} with ${JSON.stringify(opts)}`, async () => {
      const messages = await fullyReadBag(name, opts);
      expect(messages).toHaveLength(expected);
      if (expected !== 0) {
        const [message] = messages;
        expect(message).toBeDefined();
        expect(message!.timestamp).toBeDefined();
      }
      if (done != undefined) {
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
  testNumberOfMessages(FILENAME, 0, { startTime: fromDate(new Date()) });
  testNumberOfMessages(FILENAME, 0, { endTime: { sec: -1, nsec: -1 } });

  it("returns chunkOffset and totalChunks on read results", async () => {
    const filename = getFixture();
    const bag = await Bag.open(filename);
    const messages: ReadResult<unknown>[] = [];
    await bag.readMessages({}, (msg) => {
      messages.push(msg);
    });
    expect(messages[0]!.chunkOffset).toBe(0);
    expect(messages[0]!.totalChunks).toBe(1);
  });

  it("reads topics", async () => {
    const bag = await Bag.open(getFixture());
    const topics = [...bag.connections.values()].map((connection) => connection.topic);
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
    expect(messages[0]!.message).toMatchSnapshot();
  });

  it("can read bag twice at once", async () => {
    const bag = await Bag.open(getFixture());
    const messages1: ReadResult<unknown>[] = [];
    const messages2: ReadResult<unknown>[] = [];
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
    const messages = await fullyReadBag<LinearMessage>(FILENAME, opts);
    const msg = messages[0]!;
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

  it("freezes when requested", async () => {
    const [notFrozenMsg] = await fullyReadBag<LinearMessage>(FILENAME, { topics: ["/turtle1/cmd_vel"] });
    expect(notFrozenMsg!.message.linear).toEqual({ x: 2, y: 0, z: 0 });
    notFrozenMsg!.message.linear.z = 100;
    expect(notFrozenMsg!.message.linear).toEqual({ x: 2, y: 0, z: 100 });

    const [frozenMsg] = await fullyReadBag<LinearMessage>(FILENAME, { topics: ["/turtle1/cmd_vel"], freeze: true });
    expect(frozenMsg!.message.linear).toEqual({ x: 2, y: 0, z: 0 });
    expect(() => {
      frozenMsg!.message.linear.z = 100;
    }).toThrow();
    expect(() => {
      frozenMsg!.timestamp.sec = 0;
    }).toThrow();
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

  it("reads messages from a shuffled bag", async () => {
    const topics = [
      "/cloud_nodelet/parameter_descriptions",
      "/cloud_nodelet/parameter_updates",
      "/diagnostics",
      "/gps/fix",
      "/gps/rtkfix",
      "/gps/time",
      "/obs1/gps/rtkfix",
      "/obs1/gps/time",
      "/radar/range",
      "/radar/tracks",
      "/rosout",
      "/tf",
    ];
    const messages = await fullyReadBag("demo-shuffled", {
      topics,
      noParse: true,
      endTime: { sec: 1490148912, nsec: 600000000 },
    });

    // First make sure that the messages were actually shuffled.
    const smallerMessages = messages.map(({ timestamp, chunkOffset }) => ({ timestamp, chunkOffset }));
    expect(smallerMessages[0]).toBeDefined();
    const sortedMessages = [...smallerMessages];
    sortedMessages.sort((a, b) => compare(a.timestamp, b.timestamp));
    expect(smallerMessages).not.toEqual(sortedMessages);

    // And make sure that the chunks were also overlapping, ie. their chunksOffets are interlaced.
    expect(sortedMessages.map(({ chunkOffset }) => chunkOffset)).toEqual([0, 2, 0, 1, 1, 0, 0, 0, 2]);

    // Now make sure that we have the number of messages that we expect from this fixture.
    expect(messages).toHaveLength(9);
  });

  describe("compression", () => {
    it("throws if compression scheme is not registered", async () => {
      const bag = await Bag.open(getFixture("example-bz2"));
      await expect(async () => await bag.readMessages({}, () => {})).rejects.toThrow("compression");
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
          lz4: (buffer: Buffer) => Buffer.from(lz4.decompress(buffer)),
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
            const buff = Buffer.from(lz4.decompress(buffer));
            expect(buff.byteLength).toBe(size);
            return buff;
          },
        },
      });
    });
  });
});
