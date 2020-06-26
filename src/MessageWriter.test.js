// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import { MessageReader } from "./MessageReader";
import { MessageWriter } from "./MessageWriter";
import { parseMessageDefinition } from "./parseMessageDefinition";

const getStringBuffer = (str: string) => {
  const data = new Buffer(str, "utf8");
  const len = new Buffer(4);
  len.writeInt32LE(data.byteLength, 0);
  return Buffer.concat([len, data]);
};

describe("MessageWriter", () => {
  describe("simple type", () => {
    const testNum = (type: string, size: number, expected: any, cb: (buffer: Buffer) => any) => {
      const buffer = new Buffer(size);
      const message = { foo: expected };
      cb(buffer);
      it(`writes message ${JSON.stringify(message)} containing ${type}`, () => {
        const writer = new MessageWriter(parseMessageDefinition(`${type} foo`));
        expect(
          writer.writeMessage({
            foo: expected,
          })
        ).toEqual(buffer);
      });
    };

    testNum("int8", 1, -3, (buffer) => buffer.writeInt8(-3, 0));
    testNum("uint8", 1, 13, (buffer) => buffer.writeInt8(13, 0));
    testNum("int16", 2, -21, (buffer) => buffer.writeInt16LE(-21, 0));
    testNum("uint16", 2, 21, (buffer) => buffer.writeUInt16LE(21, 0));
    testNum("int32", 4, -210010, (buffer) => buffer.writeInt32LE(-210010, 0));
    testNum("uint32", 4, 210010, (buffer) => buffer.writeUInt32LE(210010, 0));
    testNum("float32", 4, 5.5, (buffer) => buffer.writeFloatLE(5.5, 0));
    testNum("float64", 8, 0xdeadbeefcafebabe, (buffer) => buffer.writeDoubleLE(0xdeadbeefcafebabe, 0));

    it("writes strings", () => {
      const writer = new MessageWriter(parseMessageDefinition("string name"));
      const buff = getStringBuffer("test");
      expect(writer.writeMessage({ name: "test" })).toEqual(buff);
    });

    it("writes JSON", () => {
      const writer = new MessageWriter(parseMessageDefinition("#pragma rosbag_parse_json\nstring dummy"));
      const buff = getStringBuffer('{"foo":123,"bar":{"nestedFoo":456}}');
      expect(
        writer.writeMessage({
          dummy: { foo: 123, bar: { nestedFoo: 456 } },
        })
      ).toEqual(buff);

      const writerWithNestedComplexType = new MessageWriter(
        parseMessageDefinition(`#pragma rosbag_parse_json
      string dummy
      Account account
      ============
      MSG: custom_type/Account
      string name
      uint16 id
      `)
      );
      expect(
        writerWithNestedComplexType.writeMessage({
          dummy: { foo: 123, bar: { nestedFoo: 456 } },
          account: { name: '{"first":"First","last":"Last"}}', id: 100 },
        })
      ).toEqual(Buffer.concat([buff, getStringBuffer('{"first":"First","last":"Last"}}'), new Buffer([100, 0x00])]));

      const writerWithTrailingPragmaComment = new MessageWriter(
        parseMessageDefinition(`#pragma rosbag_parse_json
      string dummy
      Account account
      #pragma rosbag_parse_json
      ============
      MSG: custom_type/Account
      string name
      uint16 id
      `)
      );
      expect(
        writerWithTrailingPragmaComment.writeMessage({
          dummy: { foo: 123, bar: { nestedFoo: 456 } },
          account: { name: '{"first":"First","last":"Last"}}', id: 100 },
        })
      ).toEqual(Buffer.concat([buff, getStringBuffer('{"first":"First","last":"Last"}}'), new Buffer([100, 0x00])]));
    });

    it("writes time", () => {
      const writer = new MessageWriter(parseMessageDefinition("time right_now"));
      const buff = new Buffer(8);
      const now = new Date();
      now.setSeconds(31);
      now.setMilliseconds(0);
      const seconds = Math.round(now.getTime() / 1000);
      buff.writeUInt32LE(seconds, 0);
      buff.writeUInt32LE(1000000, 4);
      now.setMilliseconds(1);
      expect(
        writer.writeMessage({
          right_now: {
            nsec: 1000000,
            sec: seconds,
          },
        })
      ).toEqual(buff);
    });
  });

  describe("array", () => {
    it("writes variable length string array", () => {
      const writer = new MessageWriter(parseMessageDefinition("string[] names"));
      const buffer = Buffer.concat([
        // variable length array has int32 as first entry
        new Buffer([0x03, 0x00, 0x00, 0x00]),
        getStringBuffer("foo"),
        getStringBuffer("bar"),
        getStringBuffer("baz"),
      ]);
      expect(
        writer.writeMessage({
          names: ["foo", "bar", "baz"],
        })
      ).toEqual(buffer);
    });

    it("writes fixed length arrays", () => {
      const writer1 = new MessageWriter(parseMessageDefinition("string[1] names"));
      const writer2 = new MessageWriter(parseMessageDefinition("string[2] names"));
      const writer3 = new MessageWriter(parseMessageDefinition("string[3] names"));
      expect(
        writer1.writeMessage({
          names: ["foo", "bar", "baz"],
        })
      ).toEqual(getStringBuffer("foo"));
      expect(
        writer2.writeMessage({
          names: ["foo", "bar", "baz"],
        })
      ).toEqual(Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar")]));
      expect(
        writer3.writeMessage({
          names: ["foo", "bar", "baz"],
        })
      ).toEqual(Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar"), getStringBuffer("baz")]));
    });

    it("does not write any data for a zero length array", () => {
      const writer = new MessageWriter(parseMessageDefinition("string[] names"));
      const buffer = Buffer.concat([
        // variable length array has int32 as first entry
        new Buffer([0x00, 0x00, 0x00, 0x00]),
      ]);

      const resultBuffer = writer.writeMessage({ names: [] });
      expect(resultBuffer).toEqual(buffer);
    });

    describe("typed arrays", () => {
      it("writes a uint8[]", () => {
        const writer = new MessageWriter(parseMessageDefinition("uint8[] values\nuint8 after"));
        const message = { values: Uint8Array.from([1, 2, 3]), after: 4 };
        const result = writer.writeMessage(message);
        const buffer = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04]);
        expect(result).toEqual(buffer);
      });

      it("writes a uint8[] with a fixed length", () => {
        const writer = new MessageWriter(parseMessageDefinition("uint8[3] values\nuint8 after"));
        const message = { values: Uint8Array.from([1, 2, 3]), after: 4 };
        const result = writer.writeMessage(message);
        const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        expect(result).toEqual(buffer);
      });
    });
  });

  describe("complex types", () => {
    it("writes single complex type", () => {
      const writer = new MessageWriter(parseMessageDefinition("string firstName \n string lastName\nuint16 age"));
      const buffer = Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar"), new Buffer([0x05, 0x00])]);
      const message = {
        firstName: "foo",
        lastName: "bar",
        age: 5,
      };
      expect(writer.writeMessage(message)).toEqual(buffer);
    });

    it("writes nested complex types", () => {
      const messageDefinition = `
      string username
      Account account
      ============
      MSG: custom_type/Account
      string name
      uint16 id
      `;
      const writer = new MessageWriter(parseMessageDefinition(messageDefinition));
      const buffer = Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar"), new Buffer([100, 0x00])]);
      const message = {
        username: "foo",
        account: {
          name: "bar",
          id: 100,
        },
      };
      expect(writer.writeMessage(message)).toEqual(buffer);
    });

    it("writes nested complex types with arrays", () => {
      const messageDefinition = `
      string username
      Account[] accounts
      ============
      MSG: custom_type/Account
      string name
      uint16 id
      `;
      const writer = new MessageWriter(parseMessageDefinition(messageDefinition));
      const buffer = Buffer.concat([
        getStringBuffer("foo"),
        // uint32LE length of array (2)
        new Buffer([0x02, 0x00, 0x00, 0x00]),
        getStringBuffer("bar"),
        new Buffer([100, 0x00]),
        getStringBuffer("baz"),
        new Buffer([101, 0x00]),
      ]);
      const message = {
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
      };
      expect(writer.writeMessage(message)).toEqual(buffer);
    });

    it("writes complex type with nested arrays", () => {
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

      const writer = new MessageWriter(parseMessageDefinition(messageDefinition));
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

      const message = {
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
      };

      expect(writer.writeMessage(message)).toEqual(buffer);
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

    it("writes bytes and constants", () => {
      const writer = new MessageWriter(parseMessageDefinition(withBytesAndBools));
      const buffer = Buffer.concat([Buffer.from([0x01]), Buffer.from([0x00]), getStringBuffer("foo")]);

      const message = {
        level: true,
        status: {
          leve: 0,
          name: "foo",
        },
      };

      expect(writer.writeMessage(message)).toEqual(buffer);
    });
  });

  describe("calculateBufferSize", () => {
    it("with a complex type", () => {
      const messageDefinition = `
      string username
      Account[] accounts
      ============
      MSG: custom_type/Account
      string name
      uint16 id
      bool isActive
      Photo[] photos

      =======
      MSG: custom_type/Photo
      string url
      uint8[] ids
      `;
      const message = {
        username: "foo",
        accounts: [
          {
            name: "bar",
            id: 100,
            isActive: true,
            photos: [
              {
                url: "http://foo.com",
                ids: Uint8Array.from([10, 100]),
              },
              {
                url: "http://bar.com",
                ids: Uint8Array.from([12]),
              },
              {
                url: "http://zug.com",
                ids: Uint8Array.from([]),
              },
            ],
          },
          {
            name: "baz",
            id: 101,
            isActive: false,
            photos: [],
          },
        ],
      };

      const writer = new MessageWriter(parseMessageDefinition(messageDefinition));
      expect(writer.calculateBufferSize(message)).toEqual(108);
    });
  });

  describe("MessageReader and MessageWriter outputs are compatible", () => {
    it("with a complex type", () => {
      const messageDefinition = `
      string username
      Account[] accounts
      ============
      MSG: custom_type/Account
      string name
      uint16 id
      bool isActive
      Photo[] photos

      =======
      MSG: custom_type/Photo
      string url
      uint8[] ids
      `;

      const message = {
        username: "foo",
        accounts: [
          {
            name: "bar",
            id: 100,
            isActive: true,
            photos: [
              {
                url: "http://foo.com",
                ids: Uint8Array.from([10, 100]),
              },
              {
                url: "http://bar.com",
                ids: Uint8Array.from([12]),
              },
              {
                url: "http://zug.com",
                ids: Uint8Array.from([]),
              },
            ],
          },
          {
            name: "baz",
            id: 101,
            isActive: false,
            photos: [],
          },
        ],
      };

      const reader = new MessageReader(parseMessageDefinition(messageDefinition));
      const writer = new MessageWriter(parseMessageDefinition(messageDefinition));
      expect(reader.readMessage(writer.writeMessage(message))).toEqual(message);
    });
  });
});
