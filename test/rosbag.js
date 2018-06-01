// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import fs from "fs";
import { expect } from "chai";
import lz4 from "lz4js";
import compress from "compressjs";

import Bag from "../lib/bag";
import { Time } from "../lib";

const FILENAME = "example";

function getFixture(filename = FILENAME) {
  return `${__dirname}/fixtures/${filename}.bag`;
}

async function fullyReadBag(name, opts) {
  const filename = getFixture(name);
  expect(fs.existsSync(filename)).to.eql(true);
  const bag = await Bag.open(filename);
  const messages = [];
  await bag.readMessages(opts, (msg) => messages.push(msg));
  return messages;
}

describe("rosbag - high-level api", () => {
  const testNumberOfMessages = (name, expected, opts = {}, done) => {
    it(`finds ${expected} messages in ${name} with ${JSON.stringify(opts)}`, async () => {
      const messages = await fullyReadBag(name, opts);
      expect(messages).to.have.length(expected);
      if (expected) {
        const [message] = messages;
        expect(message).to.not.equal(undefined);
        expect(message.timestamp).to.not.equal(undefined);
      }
      if (done) {
        done(messages);
      }
    });
  };

  testNumberOfMessages(FILENAME, 8647, { startTime: new Time(-1, -1) });
  testNumberOfMessages(FILENAME, 8647, { startTime: new Time(0, 0) });
  testNumberOfMessages(FILENAME, 1, {
    startTime: new Time(1396293887, 846735850),
    endTime: new Time(1396293887, 846735850),
  });
  testNumberOfMessages(FILENAME, 319, {
    startTime: new Time(1396293886, 846735850),
    endTime: new Time(1396293888, 846735850),
  });
  testNumberOfMessages(FILENAME, 0, { endTime: new Time(0, 0) });
  testNumberOfMessages(FILENAME, 0, { startTime: Time.fromDate(new Date()) });
  testNumberOfMessages(FILENAME, 0, { endTime: new Time(-1, -1) });

  let calledMapEach = 0;
  testNumberOfMessages(
    FILENAME,
    8647,
    {
      mapEach: ({ topic, header, timestamp }) => {
        calledMapEach++;
        return { topic, header, timestamp };
      },
    },
    (messages) => {
      // assert that only topic, header, and timestamp were retained
      expect(Object.keys(messages[0]).length).to.equal(3);
      // assert that the mapEach function was only invoked once
      expect(calledMapEach).to.equal(8647);
    }
  );

  it("returns chunkOffset and totalChunks on read results", async () => {
    const filename = getFixture();
    const bag = await Bag.open(filename);
    const messages = [];
    await bag.readMessages({}, (msg) => messages.push(msg));
    expect(messages[0].chunkOffset).to.equal(0);
    expect(messages[0].totalChunks).to.equal(1);
  });

  it("reads topics", async () => {
    const bag = await Bag.open(getFixture());
    const topics = Object.values(bag.connections).map((con) => con.topic);
    expect(topics).to.eql([
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

  it("reads poses", async () => {
    const opts = { topics: ["/turtle1/cmd_vel"] };
    const messages = await fullyReadBag(FILENAME, opts);
    const [msg] = messages;
    const { linear } = msg.message;
    expect(msg.timestamp).to.eql({
      sec: 1396293889,
      nsec: 366115136,
    });
    expect(linear).to.eql({
      x: 2,
      y: 0,
      z: 0,
    });
  });

  it("reads messages filtered to a specific topic", async () => {
    const messages = await fullyReadBag(FILENAME, { topics: ["/turtle1/color_sensor"] });
    const topics = messages.map((msg) => msg.topic);
    expect(topics).to.have.length(1351);
    topics.forEach((topic) => expect(topic).to.equal("/turtle1/color_sensor"));
  });

  it("reads messages filtered to multiple topics", async () => {
    const opts = { topics: ["/turtle1/color_sensor", "/turtle2/color_sensor"] };
    const messages = await fullyReadBag(FILENAME, opts);
    const topics = messages.map((msg) => msg.topic);
    expect(topics).to.have.length(2695);
    topics.forEach((topic) =>
      expect(topic === "/turtle1/color_sensor" || topic === "/turtle2/color_sensor").to.equal(true)
    );
  });

  describe("compression", () => {
    it("throws if compression scheme is not registered", async () => {
      let errorThrown = false;
      const bag = await Bag.open(getFixture("example-bz2"));
      try {
        await bag.readMessages({}, () => {});
      } catch (e) {
        expect(e.message).to.contain("compression");
        errorThrown = true;
      }
      expect(errorThrown).to.equal(true);
    });

    it("reads bz2 with supplied decompression callback", async () => {
      const messages = await fullyReadBag("example-bz2", {
        topics: ["/turtle1/color_sensor"],
        decompress: {
          bz2: (buffer) => {
            const arr = compress.Bzip2.decompressFile(buffer);
            return Buffer.from(arr);
          },
        },
      });
      const topics = messages.map((msg) => msg.topic);
      expect(topics).to.have.length(1351);
      topics.forEach((topic) => expect(topic).to.equal("/turtle1/color_sensor"));
    });

    it("reads lz4 with supplied decompression callback", async () => {
      const messages = await fullyReadBag("example-lz4", {
        topics: ["/turtle1/color_sensor"],
        decompress: {
          lz4: (buffer) => new Buffer(lz4.decompress(buffer)),
        },
      });
      const topics = messages.map((msg) => msg.topic);
      expect(topics).to.have.length(1351);
      topics.forEach((topic) => expect(topic).to.equal("/turtle1/color_sensor"));
    });

    it("calls decompress with the chunk size", async () => {
      await fullyReadBag("example-lz4", {
        startTime: new Time(1396293887, 846735850),
        endTime: new Time(1396293887, 846735850),
        topics: ["/turtle1/color_sensor"],
        decompress: {
          lz4: (buffer, size) => {
            expect(size).to.equal(743449);
            return new Buffer(lz4.decompress(buffer));
          },
        },
      });
    });
  });
});
