// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { expect } from "chai";
import MessageReader from "../lib/MessageReader";

const getStringBuffer = (str) => {
  const data = new Buffer(str, "utf8");
  const len = new Buffer(4);
  len.writeInt32LE(data.byteLength);
  return Buffer.concat([len, data]);
};

const buildReader = (def) => new MessageReader(def);

describe("MessageReader", () => {
  describe("simple type", () => {
    const testNum = (type, size, expected, cb) => {
      const buffer = new Buffer(size);
      cb(buffer);
      it(`parses buffer ${JSON.stringify(buffer)} containing ${type}`, () => {
        const reader = buildReader(`${type} foo`);
        expect(reader.readMessage(buffer)).to.eql({
          foo: expected,
        });
      });
    };

    testNum("int8", 1, -3, (buffer) => buffer.writeInt8(-3));
    testNum("uint8", 1, 13, (buffer) => buffer.writeInt8(13));
    testNum("int16", 2, -21, (buffer) => buffer.writeInt16LE(-21));
    testNum("uint16", 2, 21, (buffer) => buffer.writeUInt16LE(21));
    testNum("int32", 4, -210010, (buffer) => buffer.writeInt32LE(-210010));
    testNum("uint32", 4, 210010, (buffer) => buffer.writeUInt32LE(210010));
    testNum("float32", 4, 5.5, (buffer) => buffer.writeFloatLE(5.5));
    testNum("float64", 8, 0xdeadbeefcafebabe, (buffer) => buffer.writeDoubleLE(0xdeadbeefcafebabe));

    it("parses string", () => {
      const reader = buildReader("string name");
      const buff = getStringBuffer("test");
      expect(reader.readMessage(buff)).to.eql({
        name: "test",
      });
    });

    it("parses time", () => {
      const reader = buildReader("time right_now");
      const buff = new Buffer(8);
      const now = new Date();
      now.setSeconds(31);
      now.setMilliseconds(0);
      const seconds = Math.round(now.getTime() / 1000);
      buff.writeUInt32LE(seconds);
      buff.writeUInt32LE(1000000, 4);
      now.setMilliseconds(1);
      expect(reader.readMessage(buff)).to.eql({
        right_now: {
          nsec: 1000000,
          sec: seconds,
        },
      });
    });
  });

  it("ignores comment lines", () => {
    const messageDefinition = `
    # your first name goes here
    string firstName

    # last name here
    ### foo bar baz?
    string lastName
    `;
    const reader = buildReader(messageDefinition);
    const buffer = Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar")]);
    expect(reader.readMessage(buffer)).to.eql({
      firstName: "foo",
      lastName: "bar",
    });
  });

  describe("array", () => {
    it("parses variable length string array", () => {
      const reader = buildReader("string[] names");
      const buffer = Buffer.concat([
        // variable length array has int32 as first entry
        new Buffer([0x03, 0x00, 0x00, 0x00]),
        getStringBuffer("foo"),
        getStringBuffer("bar"),
        getStringBuffer("baz"),
      ]);
      expect(reader.readMessage(buffer)).to.eql({
        names: ["foo", "bar", "baz"],
      });
    });

    it("parses fixed length arrays", () => {
      const parser1 = buildReader("string[1] names");
      const parser2 = buildReader("string[2] names");
      const parser3 = buildReader("string[3] names");
      const buffer = Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar"), getStringBuffer("baz")]);
      expect(parser1.readMessage(buffer)).to.eql({
        names: ["foo"],
      });
      expect(parser2.readMessage(buffer)).to.eql({
        names: ["foo", "bar"],
      });
      expect(parser3.readMessage(buffer)).to.eql({
        names: ["foo", "bar", "baz"],
      });
    });

    it("uses an empty array for a 0 length array", () => {
      const reader = buildReader("string[] names");
      const buffer = Buffer.concat([
        // variable length array has int32 as first entry
        new Buffer([0x00, 0x00, 0x00, 0x00]),
      ]);

      const message = reader.readMessage(buffer);
      expect(message).to.eql({ names: [] });
    });

    describe("typed arrays", () => {
      it("uint8[] uses the same backing buffer", () => {
        const reader = buildReader("uint8[] values\nuint8 after");
        const buffer = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { values, after } = result;
        expect(values instanceof Uint8Array).to.equal(true);
        expect(values.buffer).to.equal(buffer.buffer);
        expect(values.length).to.equal(3);
        expect(values[0]).to.equal(1);
        expect(values[1]).to.equal(2);
        expect(values[2]).to.equal(3);

        // Ensure the next value after the array gets read properly
        expect(after).to.equal(4);
        expect(values.buffer.byteLength).to.be.greaterThan(3);
      });

      it("parses uint8[] with a fixed length", () => {
        const reader = buildReader("uint8[3] values\nuint8 after");
        const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { values, after } = result;
        expect(values instanceof Uint8Array).to.equal(true);
        expect(values.buffer).to.equal(buffer.buffer);
        expect(values.length).to.equal(3);
        expect(values[0]).to.equal(1);
        expect(values[1]).to.equal(2);
        expect(values[2]).to.equal(3);

        // Ensure the next value after the array gets read properly
        expect(after).to.equal(4);
        expect(values.buffer.byteLength).to.be.greaterThan(3);
      });

      it("int8[] uses the same backing buffer", () => {
        const reader = buildReader("int8[] values\nint8 after");
        const buffer = new Buffer([0x03, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { values, after } = result;
        expect(values instanceof Int8Array).to.equal(true);
        expect(values.buffer).to.equal(buffer.buffer);
        expect(values.length).to.equal(3);
        expect(values[0]).to.equal(1);
        expect(values[1]).to.equal(2);
        expect(values[2]).to.equal(3);

        // Ensure the next value after the array gets read properly
        expect(after).to.equal(4);
        expect(values.buffer.byteLength).to.be.greaterThan(3);
      });

      it("parses int8[] with a fixed length", () => {
        const reader = buildReader("int8[3] values\nint8 after");
        const buffer = new Buffer([0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { values, after } = result;
        expect(values instanceof Int8Array).to.equal(true);
        expect(values.buffer).to.equal(buffer.buffer);
        expect(values.length).to.equal(3);
        expect(values[0]).to.equal(1);
        expect(values[1]).to.equal(2);
        expect(values[2]).to.equal(3);

        // Ensure the next value after the array gets read properly
        expect(after).to.equal(4);
        expect(values.buffer.byteLength).to.be.greaterThan(3);
      });

      it("parses combinations of typed arrays", () => {
        const reader = buildReader("int8[] first\nuint8[2] second");
        const buffer = new Buffer([0x02, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { first, second } = result;

        expect(first instanceof Int8Array).to.equal(true);
        expect(first.buffer).to.equal(buffer.buffer);
        expect(first.length).to.equal(2);
        expect(first[0]).to.equal(1);
        expect(first[1]).to.equal(2);

        expect(second instanceof Uint8Array).to.equal(true);
        expect(second.buffer).to.equal(buffer.buffer);
        expect(second.length).to.equal(2);
        expect(second[0]).to.equal(3);
        expect(second[1]).to.equal(4);
      });
    });
  });

  describe("complex types", () => {
    it("parses single complex type", () => {
      const reader = buildReader("string firstName \n string lastName\nuint16 age");
      const buffer = Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar"), new Buffer([0x05, 0x00])]);
      expect(reader.readMessage(buffer)).to.eql({
        firstName: "foo",
        lastName: "bar",
        age: 5,
      });
    });

    it("parses nested complex types", () => {
      const messageDefinition = `
      string username
      Account account
      ============
      MSG: custom_type/Account
      string name
      uint16 id
      `;
      const reader = buildReader(messageDefinition);
      const buffer = Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar"), new Buffer([100, 0x00])]);
      expect(reader.readMessage(buffer)).to.eql({
        username: "foo",
        account: {
          name: "bar",
          id: 100,
        },
      });
    });

    it("parses nested complex types with arrays", () => {
      const messageDefinition = `
      string username
      Account[] accounts
      ============
      MSG: custom_type/Account
      string name
      uint16 id
      `;
      const reader = buildReader(messageDefinition);
      const buffer = Buffer.concat([
        getStringBuffer("foo"),
        // uint32LE length of array (2)
        new Buffer([0x02, 0x00, 0x00, 0x00]),
        getStringBuffer("bar"),
        new Buffer([100, 0x00]),
        getStringBuffer("baz"),
        new Buffer([101, 0x00]),
      ]);
      expect(reader.readMessage(buffer)).to.eql({
        username: "foo",
        accounts: [
          {
            name: "bar",
            id: 100,
          },
          {
            name: "baz",
            id: 101,
          },
        ],
      });
    });

    it("parses complex type with nested arrays", () => {
      const messageDefinition = `
      string username
      Account[] accounts
      ============
      MSG: custom_type/Account
      string name
      uint16 id
      Photo[] photos

      =======
      MSG: custom_type/Photo
      string url
      uint8 id
      `;

      const reader = buildReader(messageDefinition);
      const buffer = Buffer.concat([
        getStringBuffer("foo"),
        // uint32LE length of Account array (2)
        new Buffer([0x02, 0x00, 0x00, 0x00]),
        // name
        getStringBuffer("bar"),
        // id
        new Buffer([100, 0x00]),
        // uint32LE length of Photo array (3)
        new Buffer([0x03, 0x00, 0x00, 0x00]),
        // photo url
        getStringBuffer("http://foo.com"),
        // photo id
        new Buffer([10]),

        // photo url
        getStringBuffer("http://bar.com"),
        // photo id
        new Buffer([12]),

        // photo url
        getStringBuffer("http://zug.com"),
        // photo id
        new Buffer([16]),

        // next account
        getStringBuffer("baz"),
        new Buffer([101, 0x00]),
        // uint32LE length of Photo array (0)
        new Buffer([0x00, 0x00, 0x00, 0x00]),
      ]);

      expect(reader.readMessage(buffer)).to.eql({
        username: "foo",
        accounts: [
          {
            name: "bar",
            id: 100,
            photos: [
              {
                url: "http://foo.com",
                id: 10,
              },
              {
                url: "http://bar.com",
                id: 12,
              },
              {
                url: "http://zug.com",
                id: 16,
              },
            ],
          },
          {
            name: "baz",
            id: 101,
            photos: [],
          },
        ],
      });
    });

    const withBytesAndBools = `
      byte OK=0
      byte WARN=1
      byte ERROR=2
      byte STALE=3
      byte FOO = 3 # the space exists in some topics
      byte FLOAT64      = 8

      bool level\t\t# level of operation enumerated above

      DiagnosticStatus status

      ================================================================================
      MSG: diagnostic_msgs/DiagnosticStatus
      # This message holds the status of an individual component of the robot.
      #

      # Possible levels of operations
      byte OK=0
      byte WARN=1  # Comment        # FLOATING OUT HERE
      byte ERROR=2
      byte STALE=3

      byte    level # level of operation enumerated above
      string name # a description of the test/component reporting`;

    it("parses bytes and constants", () => {
      const reader = buildReader(withBytesAndBools);
      const buffer = Buffer.concat([Buffer.from([0x01]), Buffer.from([0x00]), getStringBuffer("foo")]);

      const { level, status } = reader.readMessage(buffer);
      expect(level).to.equal(true);
      expect(status.level).to.equal(0);
      expect(status.name).to.equal("foo");
    });
  });

  describe("custom parser", () => {
    it("Point[] converts to custom type", () => {
      const messageDefinition = `
      geometry_msgs/Point[] points
      ============
      MSG: geometry_msgs/Point
      float64 x
      float64 y
      float64 z
      `;
      const parsers = {
        "geometry_msgs/Point[]": (reader) => {
          const length = reader.uint32();
          const result = new Float64Array(length * 3);
          result[0] = reader.float64();
          result[1] = reader.float64();
          result[2] = reader.float64();
          return result;
        },
      };
      const reader = new MessageReader(messageDefinition, parsers);
      const buffer = Buffer.from([
        0x01,
        0x00,
        0x00,
        0x00, // header
        0x00, // x
        0x00, // x
        0x00, // x
        0x00, // x
        0x00, // x
        0x00, // x
        0xf0, // x
        0x3f, // x = 1
        0x00, // y
        0x00, // y
        0x00, // y
        0x00, // y
        0x00, // y
        0x00, // y
        0x00, // y
        0x40, // y = 2
        0x00, // z
        0x00, // z
        0x00, // z
        0x00, // z
        0x00, // z
        0x00, // z
        0x08, // z
        0x40, // z = 3
      ]);
      const result = reader.readMessage(buffer);
      const { points } = result;
      expect(points[0]).to.eql(1);
      expect(points[1]).to.eql(2);
      expect(points[2]).to.eql(3);
    });
  });
});
