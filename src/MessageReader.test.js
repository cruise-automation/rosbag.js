// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import { MessageReader } from "./MessageReader";

const getStringBuffer = (str: string) => {
  const data = new Buffer(str, "utf8");
  const len = new Buffer(4);
  len.writeInt32LE(data.byteLength, 0);
  return Buffer.concat([len, data]);
};

const buildReader = (def: string) => new MessageReader(def);

describe("MessageReader", () => {
  describe("simple type", () => {
    const testNum = (type: string, size: number, expected: any, cb: (buffer: Buffer) => any) => {
      const buffer = new Buffer(size);
      cb(buffer);
      it(`parses buffer ${JSON.stringify(buffer)} containing ${type}`, () => {
        const reader = buildReader(`${type} foo`);
        expect(reader.readMessage(buffer)).toEqual({
          foo: expected,
        });
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

    it("parses string", () => {
      const reader = buildReader("string name");
      const buff = getStringBuffer("test");
      expect(reader.readMessage(buff)).toEqual({
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
      buff.writeUInt32LE(seconds, 0);
      buff.writeUInt32LE(1000000, 4);
      now.setMilliseconds(1);
      expect(reader.readMessage(buff)).toEqual({
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
    expect(reader.readMessage(buffer)).toEqual({
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
      expect(reader.readMessage(buffer)).toEqual({
        names: ["foo", "bar", "baz"],
      });
    });

    it("parses fixed length arrays", () => {
      const parser1 = buildReader("string[1] names");
      const parser2 = buildReader("string[2] names");
      const parser3 = buildReader("string[3] names");
      const buffer = Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar"), getStringBuffer("baz")]);
      expect(parser1.readMessage(buffer)).toEqual({
        names: ["foo"],
      });
      expect(parser2.readMessage(buffer)).toEqual({
        names: ["foo", "bar"],
      });
      expect(parser3.readMessage(buffer)).toEqual({
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
      expect(message).toEqual({ names: [] });
    });

    describe("typed arrays", () => {
      it("uint8[] uses the same backing buffer", () => {
        const reader = buildReader("uint8[] values\nuint8 after");
        const buffer = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { values, after } = result;
        expect(values instanceof Uint8Array).toBe(true);
        expect(values.buffer).toBe(buffer.buffer);
        expect(values.length).toBe(3);
        expect(values[0]).toBe(1);
        expect(values[1]).toBe(2);
        expect(values[2]).toBe(3);

        // Ensure the next value after the array gets read properly
        expect(after).toBe(4);
        expect(values.buffer.byteLength).toBeGreaterThan(3);
      });

      it("parses uint8[] with a fixed length", () => {
        const reader = buildReader("uint8[3] values\nuint8 after");
        const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { values, after } = result;
        expect(values instanceof Uint8Array).toBe(true);
        expect(values.buffer).toBe(buffer.buffer);
        expect(values.length).toBe(3);
        expect(values[0]).toBe(1);
        expect(values[1]).toBe(2);
        expect(values[2]).toBe(3);

        // Ensure the next value after the array gets read properly
        expect(after).toBe(4);
        expect(values.buffer.byteLength).toBeGreaterThan(3);
      });

      it("int8[] uses the same backing buffer", () => {
        const reader = buildReader("int8[] values\nint8 after");
        const buffer = new Buffer([0x03, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { values, after } = result;
        expect(values instanceof Int8Array).toBe(true);
        expect(values.buffer).toBe(buffer.buffer);
        expect(values.length).toBe(3);
        expect(values[0]).toBe(1);
        expect(values[1]).toBe(2);
        expect(values[2]).toBe(3);

        // Ensure the next value after the array gets read properly
        expect(after).toBe(4);
        expect(values.buffer.byteLength).toBeGreaterThan(3);
      });

      it("parses int8[] with a fixed length", () => {
        const reader = buildReader("int8[3] values\nint8 after");
        const buffer = new Buffer([0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { values, after } = result;
        expect(values instanceof Int8Array).toBe(true);
        expect(values.buffer).toBe(buffer.buffer);
        expect(values.length).toBe(3);
        expect(values[0]).toBe(1);
        expect(values[1]).toBe(2);
        expect(values[2]).toBe(3);

        // Ensure the next value after the array gets read properly
        expect(after).toBe(4);
        expect(values.buffer.byteLength).toBeGreaterThan(3);
      });

      it("parses combinations of typed arrays", () => {
        const reader = buildReader("int8[] first\nuint8[2] second");
        const buffer = new Buffer([0x02, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04]);
        const result = reader.readMessage(buffer);
        const { first, second } = result;

        expect(first instanceof Int8Array).toBe(true);
        expect(first.buffer).toBe(buffer.buffer);
        expect(first.length).toBe(2);
        expect(first[0]).toBe(1);
        expect(first[1]).toBe(2);

        expect(second instanceof Uint8Array).toBe(true);
        expect(second.buffer).toBe(buffer.buffer);
        expect(second.length).toBe(2);
        expect(second[0]).toBe(3);
        expect(second[1]).toBe(4);
      });
    });
  });

  describe("complex types", () => {
    it("parses single complex type", () => {
      const reader = buildReader("string firstName \n string lastName\nuint16 age");
      const buffer = Buffer.concat([getStringBuffer("foo"), getStringBuffer("bar"), new Buffer([0x05, 0x00])]);
      expect(reader.readMessage(buffer)).toEqual({
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
      expect(reader.readMessage(buffer)).toEqual({
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
      expect(reader.readMessage(buffer)).toEqual({
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

      expect(reader.readMessage(buffer)).toEqual({
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

      const message = reader.readMessage(buffer);
      const { level, status } = message;
      expect(level).toBe(true);
      expect(status.level).toBe(0);
      expect(status.name).toBe("foo");

      // We shouldn't expose constants on the message.
      expect(Object.keys(message).some((key) => key === "STALE")).toBe(false);
    });
  });
});
