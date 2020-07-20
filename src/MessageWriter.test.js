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
    it.only("works", () => {
      const msg = {
        header: { frame_id: "cruise_frame", stamp: { sec: 1590420912, nsec: 49899000 }, seq: 0 },
        markers: [],
        futureMarkers: [
          {
            header: { frame_id: "cruise_frame", stamp: { sec: 1590420912, nsec: 49899000 }, seq: 0 },
            pose: { orientation: { w: 1, x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 } },
            lifetime: { sec: 0, nsec: 0 },
            frame_locked: false,
            colors: [],
            text: "",
            mesh_resource: "",
            mesh_use_embedded_materials: false,
            ns: "stop_point",
            color: { r: 1, g: 0, b: 0, a: 0.5 },
            id: 1,
            action: 0,
            points: [{ x: -8816.583186611766, y: -93.67808650387451, z: 0 }],
            type: 8,
            scale: { x: 3, y: 3, z: 1 },
            metadata: {
              timestamp: "1590420912.249972000",
              id: 1,
              lane_id: 188866,
              reason: "unknown",
              stop_point: { x: -8816.583186611766, y: -93.67808650387451, z: 0 },
              type: "stop_line",
            },
          },

          {
            action: 0,
            color: {
              a: 0.5,
              b: 0,
              g: 1,
              r: 0,
            },
            colors: [],
            frame_locked: false,
            header: {
              frame_id: "cruise_frame",
              seq: 0,
              stamp: {
                nsec: 149830000,
                sec: 1577981900,
              },
            },
            id: "1bd1c843-90ac-4aa2-a811-b76c9a3ae824",
            lifetime: {
              nsec: 0,
              sec: 0,
            },
            mesh_resource: "",
            mesh_use_embedded_materials: false,
            metadata: {},
            ns: "centroid",
            points: [
              {
                x: -4039.5898656726354,
                y: -1136.6033815005796,
                z: 1,
              },
            ],
            pose: {
              orientation: {
                w: 1,
                x: 0,
                y: 0,
                z: 0,
              },
              position: {
                x: 0,
                y: 0,
                z: 0,
              },
            },
            scale: {
              x: 3,
              y: 3,
              z: 1,
            },
            text: "",
            type: 8,
          },
        ],
      };
      const defs = [
        {
          name: "/tables/tableflow/validation/rerun/autonomous_mode/per_frame",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/validation/rerun/autonomous_mode/per_frame/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/validation/rerun/autonomous_mode/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "in_autonomous_hot_start_mode", type: "bool", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/stop_movie_array_io/_stop_movie_array_per_instance",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/stop_movie_array_io/_stop_movie_array_per_instance/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/stop_movie_array_io/_stop_movie_array_per_instance/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "id", type: "float64", isArray: false, isComplex: false },
            { name: "lane_id", type: "float64", isArray: false, isComplex: false },
            { name: "reason", type: "string", isArray: false, isComplex: false },
            { name: "stop_point", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "type", type: "string", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/scoring/safety/per_frame",
          definitions: [
            { name: "rows", type: "/tables/tableflow/scoring/safety/per_frame/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/scoring/safety/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "collision", type: "float64", isArray: false, isComplex: false },
            { name: "id", type: "string", isArray: false, isComplex: false },
            { name: "aggregate", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/scoring/safety/labels_per_instance",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/scoring/safety/labels_per_instance/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/scoring/safety/labels_per_instance/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "id", type: "float64", isArray: false, isComplex: false },
            { name: "distance_to_collision", type: "float64", isArray: false, isComplex: false },
            { name: "angle_to_collision", type: "float64", isArray: false, isComplex: false },
            { name: "heading_difference", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/test_results",
          definitions: [{ name: "rows", type: "/tables/test_results/row", isArray: true, isComplex: true }],
        },
        {
          name: "/tables/test_results/row",
          definitions: [
            { name: "framework_version", type: "string", isArray: false, isComplex: false },
            { name: "assertions", type: "string", isArray: false, isComplex: false },
            { name: "comfort_score", type: "float64", isArray: false, isComplex: false },
            { name: "comfort_weight", type: "float64", isArray: false, isComplex: false },
            { name: "error", type: "string", isArray: false, isComplex: false },
            { name: "error_category", type: "string", isArray: false, isComplex: false },
            { name: "framework_id", type: "string", isArray: false, isComplex: false },
            { name: "performance_score", type: "float64", isArray: false, isComplex: false },
            { name: "performance_weight", type: "float64", isArray: false, isComplex: false },
            { name: "result", type: "string", isArray: false, isComplex: false },
            { name: "safety_score", type: "float64", isArray: false, isComplex: false },
            { name: "safety_weight", type: "float64", isArray: false, isComplex: false },
            { name: "scenario_uri", type: "string", isArray: false, isComplex: false },
            { name: "scenario_version", type: "string", isArray: false, isComplex: false },
            { name: "scores", type: "string", isArray: true, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/rerun/per_frame",
          definitions: [
            { name: "rows", type: "/tables/tableflow/rerun/per_frame/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/rerun/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "in_scorable_mode", type: "bool", isArray: false, isComplex: false },
            { name: "feature_window_end_ts", type: "string", isArray: false, isComplex: false },
            { name: "feature_window_start_ts", type: "string", isArray: false, isComplex: false },
            { name: "seeder_pose_acceleration_max", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_acceleration_mean", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_acceleration_min", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_acceleration_sum", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_curvature_max", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_curvature_mean", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_curvature_min", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_curvature_sum", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_heading_max", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_heading_mean", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_heading_min", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_heading_sum", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_jerk_max", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_jerk_mean", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_jerk_min", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_jerk_sum", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_spacial_curvature_rate_max", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_spacial_curvature_rate_mean", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_spacial_curvature_rate_min", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_spacial_curvature_rate_sum", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_travel_max", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_travel_mean", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_travel_min", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_travel_sum", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_velocity_max", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_velocity_mean", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_velocity_min", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_velocity_sum", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_x_max", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_x_mean", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_x_min", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_x_sum", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_y_max", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_y_mean", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_y_min", type: "float64", isArray: false, isComplex: false },
            { name: "seeder_pose_y_sum", type: "float64", isArray: false, isComplex: false },
            { name: "feature_window_duration", type: "float64", isArray: false, isComplex: false },
            { name: "in_multi_tick_mode", type: "bool", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/metrics/per_instance",
          definitions: [
            { name: "rows", type: "/tables/tableflow/metrics/per_instance/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/metrics/per_instance/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "id", type: "float64", isArray: false, isComplex: false },
            { name: "iterates_over", type: "string", isArray: false, isComplex: false },
            { name: "time_to_collision_lc_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "min_distance_time_to_collision_lc_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "npc_segmentation", type: "string", isArray: false, isComplex: false },
            { name: "time_to_collision_rt_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "min_distance_time_to_collision_rt_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "time_to_collision", type: "float64", isArray: false, isComplex: false },
            { name: "min_distance_time_to_collision", type: "float64", isArray: false, isComplex: false },
            { name: "time_to_collision_upl_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "min_distance_time_to_collision_upl_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "time_to_collision_cut_ins_filtered", type: "float64", isArray: false, isComplex: false },
            {
              name: "min_distance_time_to_collision_cut_ins_filtered",
              type: "float64",
              isArray: false,
              isComplex: false,
            },
            { name: "time_to_collision_oncoming_filtered", type: "float64", isArray: false, isComplex: false },
            {
              name: "min_distance_time_to_collision_oncoming_filtered",
              type: "float64",
              isArray: false,
              isComplex: false,
            },
          ],
        },
        {
          name: "/tables/tableflow/metrics/per_trajectory",
          definitions: [
            { name: "rows", type: "/tables/tableflow/metrics/per_trajectory/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/metrics/per_trajectory/row",
          definitions: [
            { name: "id", type: "float64", isArray: false, isComplex: false },
            { name: "iterates_over", type: "string", isArray: false, isComplex: false },
            { name: "PET_upl_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "PET_rt_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "PET_lc_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "PET_cut_ins_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "PET", type: "float64", isArray: false, isComplex: false },
            { name: "PET_oncoming_filtered", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/metrics/per_bag",
          definitions: [
            { name: "rows", type: "/tables/tableflow/metrics/per_bag/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/metrics/per_bag/row",
          definitions: [
            { name: "ptko_upl_v2_False", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_upl_v2_True", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_cut_ins_False", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_cut_ins_True", type: "float64", isArray: false, isComplex: false },
            { name: "min_deterministic_safety_score", type: "float64", isArray: false, isComplex: false },
            { name: "min_deterministic_safety_score_timestamp", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_right_turn_False", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_right_turn_True", type: "float64", isArray: false, isComplex: false },
            { name: "min_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "max_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "avg_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "mean_sdc_metric", type: "float64", isArray: false, isComplex: false },
            { name: "min_sdc_metric", type: "float64", isArray: false, isComplex: false },
            { name: "min_sdc_timestamp", type: "float64", isArray: false, isComplex: false },
            { name: "min_sdc_actual_min_distance", type: "float64", isArray: false, isComplex: false },
            { name: "min_sdc_proj_min_dist_time_offset", type: "float64", isArray: false, isComplex: false },
            { name: "min_sdc_metric_class", type: "float64", isArray: false, isComplex: false },
            { name: "min_sdc_metric_sdc_type", type: "float64", isArray: false, isComplex: false },
            { name: "min_sdc_metric_track_id", type: "float64", isArray: false, isComplex: false },
            { name: "min_sdc_metric_av_velocity", type: "float64", isArray: false, isComplex: false },
            { name: "min_sdc_metric_track_velocity", type: "float64", isArray: false, isComplex: false },
            { name: "max_target_iap_at_tko_3", type: "string", isArray: false, isComplex: false },
            { name: "max_exclusion_iap_at_tko_3", type: "string", isArray: false, isComplex: false },
            { name: "lat_KCM_CP", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_upl_stuck_False", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_upl_stuck_True", type: "float64", isArray: false, isComplex: false },
            { name: "long_KCM_CP", type: "float64", isArray: false, isComplex: false },
            { name: "min_velocity", type: "float64", isArray: false, isComplex: false },
            { name: "max_velocity", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_oncoming_False", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_oncoming_True", type: "float64", isArray: false, isComplex: false },
            { name: "average_velocity", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_lane_change_False", type: "float64", isArray: false, isComplex: false },
            { name: "ptko_lane_change_True", type: "float64", isArray: false, isComplex: false },
            { name: "crawl_time", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/collision/road/per_frame",
          definitions: [
            { name: "rows", type: "/tables/tableflow/collision/road/per_frame/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/collision/road/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "prediction_timestamp", type: "string", isArray: false, isComplex: false },
            { name: "cruise_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_curvature", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_footprint", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_orientation", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_polygon", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_position", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_speed", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_distance_traveled", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/validation/validity/seeder_pose_divergence/rerun/per_frame",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/validation/validity/seeder_pose_divergence/rerun/per_frame/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/validation/validity/seeder_pose_divergence/rerun/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "prediction_timestamp", type: "string", isArray: false, isComplex: false },
            { name: "cruise_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_curvature", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_footprint", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_orientation", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_polygon", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_position", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_speed", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_distance_traveled", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/webviz_required_data/_smoothed_localized_pose",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/webviz_required_data/_smoothed_localized_pose/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/webviz_required_data/_smoothed_localized_pose/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "_smoothed_localized_pose", type: "geometry_msgs/PoseStamped", isArray: false, isComplex: true },
          ],
        },
        {
          name: "geometry_msgs/PoseStamped",
          definitions: [
            { isArray: false, isComplex: true, name: "header", type: "std_msgs/Header" },
            { isArray: false, isComplex: true, name: "pose", type: "geometry_msgs/Pose" },
          ],
        },
        {
          name: "std_msgs/Header",
          definitions: [
            { type: "uint32", name: "seq", isArray: false, isComplex: false },
            { type: "time", name: "stamp", isArray: false, isComplex: false },
            { type: "string", name: "frame_id", isArray: false, isComplex: false },
          ],
        },
        {
          name: "geometry_msgs/Pose",
          definitions: [
            { type: "geometry_msgs/Point", name: "position", isArray: false, isComplex: true },
            { type: "geometry_msgs/Quaternion", name: "orientation", isArray: false, isComplex: true },
          ],
        },
        {
          name: "geometry_msgs/Point",
          definitions: [
            { type: "float64", name: "x", isArray: false, isComplex: false },
            { type: "float64", name: "y", isArray: false, isComplex: false },
            { type: "float64", name: "z", isArray: false, isComplex: false },
          ],
        },
        {
          name: "geometry_msgs/Quaternion",
          definitions: [
            { type: "float64", name: "x", isArray: false, isComplex: false },
            { type: "float64", name: "y", isArray: false, isComplex: false },
            { type: "float64", name: "z", isArray: false, isComplex: false },
            { type: "float64", name: "w", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/metrics/webviz_required_data/_smoothed_localized_pose",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/metrics/webviz_required_data/_smoothed_localized_pose/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/metrics/webviz_required_data/_smoothed_localized_pose/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "_smoothed_localized_pose", type: "geometry_msgs/PoseStamped", isArray: false, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/validation/validity/seeder_pose_divergence/road/per_frame",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/validation/validity/seeder_pose_divergence/road/per_frame/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/validation/validity/seeder_pose_divergence/road/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "prediction_timestamp", type: "string", isArray: false, isComplex: false },
            { name: "cruise_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_curvature", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_footprint", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_orientation", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_polygon", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_position", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_speed", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_distance_traveled", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/validation/rerun/seeder_pose_source_valid",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/validation/rerun/seeder_pose_source_valid/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/validation/rerun/seeder_pose_source_valid/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "seeder_pose_source_valid", type: "bool", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/validation/rerun/in_valid_degraded_state",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/validation/rerun/in_valid_degraded_state/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/validation/rerun/in_valid_degraded_state/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "in_valid_degraded_state", type: "bool", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/metrics/per_frame",
          definitions: [
            { name: "rows", type: "/tables/tableflow/metrics/per_frame/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/metrics/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "time_to_collision", type: "float64", isArray: false, isComplex: false },
            { name: "npc_id_time_to_collision", type: "float64", isArray: false, isComplex: false },
            { name: "time_to_collision_lc_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "npc_id_time_to_collision_lc_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "time_to_collision_cut_ins_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "npc_id_time_to_collision_cut_ins_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "time_to_collision_upl_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "npc_id_time_to_collision_upl_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "time_to_collision_rt_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "npc_id_time_to_collision_rt_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "overlap_percentage", type: "string", isArray: false, isComplex: false },
            { name: "time_to_collision_oncoming_filtered", type: "float64", isArray: false, isComplex: false },
            { name: "npc_id_time_to_collision_oncoming_filtered", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/scoring/safety/label_ids_per_trajectory",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/scoring/safety/label_ids_per_trajectory/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/scoring/safety/label_ids_per_trajectory/row",
          definitions: [
            { name: "id", type: "float64", isArray: false, isComplex: false },
            { name: "collision_angle", type: "float64", isArray: false, isComplex: false },
            { name: "heading_difference_at_collision", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/stuck_multi_tick/collision/rerun/per_frame",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/stuck_multi_tick/collision/rerun/per_frame/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/stuck_multi_tick/collision/rerun/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "prediction_timestamp", type: "string", isArray: false, isComplex: false },
            { name: "cruise_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_curvature", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_footprint", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_orientation", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_polygon", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_position", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_speed", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_distance_traveled", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/stuck_multi_tick/collision/webviz_required_data/_smoothed_localized_pose",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/stuck_multi_tick/collision/webviz_required_data/_smoothed_localized_pose/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/stuck_multi_tick/collision/webviz_required_data/_smoothed_localized_pose/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "_smoothed_localized_pose", type: "geometry_msgs/PoseStamped", isArray: false, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/cruise_events_metrics/per_frame",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/cruise_events_metrics/per_frame/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/cruise_events_metrics/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "category", type: "string", isArray: false, isComplex: false },
            { name: "message", type: "string", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/scoring/comfort/per_frame",
          definitions: [
            { name: "rows", type: "/tables/tableflow/scoring/comfort/per_frame/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/scoring/comfort/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "aggregate", type: "float64", isArray: false, isComplex: false },
            { name: "hard_brake_model", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/stuck_multi_tick/collision/road/per_frame",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/stuck_multi_tick/collision/road/per_frame/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/stuck_multi_tick/collision/road/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "prediction_timestamp", type: "string", isArray: false, isComplex: false },
            { name: "cruise_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_curvature", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_footprint", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_orientation", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_polygon", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_position", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_speed", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_distance_traveled", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/validation/comparison/per_frame",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/validation/comparison/per_frame/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/validation/comparison/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "cruise_acceleration_road", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_acceleration_rerun", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_acceleration_abs_delta", type: "float64", isArray: false, isComplex: false },
            { name: "hot_start_reasonable_error_message", type: "string", isArray: false, isComplex: false },
            { name: "hot_start_reasonable", type: "bool", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/coupled_ncs_metrics_extraction/coupled_ncs_metrics",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/coupled_ncs_metrics_extraction/coupled_ncs_metrics/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/coupled_ncs_metrics_extraction/coupled_ncs_metrics/row",
          definitions: [
            { name: "coupled_ncs_num_nodes_mean", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_num_nodes_max", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_num_branches_mean", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_num_branches_max", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_computation_time_ms_mean", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_computation_time_ms_max", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_max_nonzero_ordinal_mean", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_max_nonzero_ordinal_max", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_max_failed_tpg_solves", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_max_invalid_tpg_solves", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_failed_tpg_solves_per_1000", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_invalid_tpg_solves_per_1000", type: "float64", isArray: false, isComplex: false },
            { name: "coupled_ncs_average_tpg_iterations", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/stuck_multi_tick/per_frame",
          definitions: [
            { name: "rows", type: "/tables/tableflow/stuck_multi_tick/per_frame/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/stuck_multi_tick/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "travel_raw", type: "float64", isArray: false, isComplex: false },
            { name: "travel_integral", type: "float64", isArray: false, isComplex: false },
            { name: "elapsed_prediction_timestamp", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/collision/rerun/per_frame",
          definitions: [
            { name: "rows", type: "/tables/tableflow/collision/rerun/per_frame/row", isArray: true, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/collision/rerun/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "prediction_timestamp", type: "string", isArray: false, isComplex: false },
            { name: "cruise_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_curvature", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_footprint", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_acceleration", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_orientation", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_polygon", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_position", type: "float64", isArray: true, isComplex: false },
            { name: "cruise_speed", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_lateral_jerk", type: "float64", isArray: false, isComplex: false },
            { name: "cruise_distance_traveled", type: "float64", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tables/tableflow/collision/webviz_required_data/_smoothed_localized_pose",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/collision/webviz_required_data/_smoothed_localized_pose/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/collision/webviz_required_data/_smoothed_localized_pose/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            { name: "_smoothed_localized_pose", type: "geometry_msgs/PoseStamped", isArray: false, isComplex: true },
          ],
        },
        {
          name: "/tables/tableflow/validation/validity/seeder_pose_divergence/comparison/per_frame",
          definitions: [
            {
              name: "rows",
              type: "/tables/tableflow/validation/validity/seeder_pose_divergence/comparison/per_frame/row",
              isArray: true,
              isComplex: true,
            },
          ],
        },
        {
          name: "/tables/tableflow/validation/validity/seeder_pose_divergence/comparison/per_frame/row",
          definitions: [
            { name: "timestamp", type: "string", isArray: false, isComplex: false },
            {
              name: "l2_distance__smoothed_localized_pose_extracted_from__scenario_generator_cruise_path_seeder_pose",
              type: "float64",
              isArray: false,
              isComplex: false,
            },
            { name: "cruise_position", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_polygon", type: "geometry_msgs/Point", isArray: false, isComplex: true },
            { name: "cruise_heading", type: "float64", isArray: false, isComplex: false },
            {
              name:
                "l2_distance__road_scenario_generator_cruise_path_seeder_pose_from__scenario_generator_cruise_path_seeder_pose",
              type: "float64",
              isArray: false,
              isComplex: false,
            },
          ],
        },
        {
          name: "future_visualization_msgs/MarkerArray",
          definitions: [
            { type: "std_msgs/Header", name: "header", isArray: false, isComplex: true },
            { isArray: true, isComplex: true, name: "markers", type: "visualization_msgs/WebvizMarker" },
            { isArray: true, isComplex: true, name: "futureMarkers", type: "visualization_msgs/WebvizMarker" },
          ],
        },
        {
          name: "visualization_msgs/MarkerArray",
          definitions: [{ isArray: true, isComplex: true, name: "markers", type: "visualization_msgs/Marker" }],
        },
        {
          name: "visualization_msgs/Marker",
          definitions: [
            { type: "uint8", name: "ARROW", isConstant: true, value: 0 },
            { type: "uint8", name: "CUBE", isConstant: true, value: 1 },
            { type: "uint8", name: "SPHERE", isConstant: true, value: 2 },
            { type: "uint8", name: "CYLINDER", isConstant: true, value: 3 },
            { type: "uint8", name: "LINE_STRIP", isConstant: true, value: 4 },
            { type: "uint8", name: "LINE_LIST", isConstant: true, value: 5 },
            { type: "uint8", name: "CUBE_LIST", isConstant: true, value: 6 },
            { type: "uint8", name: "SPHERE_LIST", isConstant: true, value: 7 },
            { type: "uint8", name: "POINTS", isConstant: true, value: 8 },
            { type: "uint8", name: "TEXT_VIEW_FACING", isConstant: true, value: 9 },
            { type: "uint8", name: "MESH_RESOURCE", isConstant: true, value: 10 },
            { type: "uint8", name: "TRIANGLE_LIST", isConstant: true, value: 11 },
            { type: "uint8", name: "ADD", isConstant: true, value: 0 },
            { type: "uint8", name: "MODIFY", isConstant: true, value: 0 },
            { type: "uint8", name: "DELETE", isConstant: true, value: 2 },
            { type: "std_msgs/Header", name: "header", isArray: false, isComplex: true },
            { type: "string", name: "ns", isArray: false, isComplex: false },
            { type: "int32", name: "id", isArray: false, isComplex: false },
            { type: "int32", name: "type", isArray: false, isComplex: false },
            { type: "int32", name: "action", isArray: false, isComplex: false },
            { type: "geometry_msgs/Pose", name: "pose", isArray: false, isComplex: true },
            { type: "geometry_msgs/Vector3", name: "scale", isArray: false, isComplex: true },
            { type: "std_msgs/ColorRGBA", name: "color", isArray: false, isComplex: true },
            { type: "duration", name: "lifetime", isArray: false, isComplex: false },
            { type: "bool", name: "frame_locked", isArray: false, isComplex: false },
            { type: "geometry_msgs/Point", name: "points", isArray: true, isComplex: true },
            { type: "std_msgs/ColorRGBA", name: "colors", isArray: true, isComplex: true },
            { type: "string", name: "text", isArray: false, isComplex: false },
            { type: "string", name: "mesh_resource", isArray: false, isComplex: false },
            { type: "bool", name: "mesh_use_embedded_materials", isArray: false, isComplex: false },
          ],
        },
        {
          name: "visualization_msgs/WebvizMarker",
          definitions: [
            { type: "uint8", name: "ARROW", isConstant: true, value: 0 },
            { type: "uint8", name: "CUBE", isConstant: true, value: 1 },
            { type: "uint8", name: "SPHERE", isConstant: true, value: 2 },
            { type: "uint8", name: "CYLINDER", isConstant: true, value: 3 },
            { type: "uint8", name: "LINE_STRIP", isConstant: true, value: 4 },
            { type: "uint8", name: "LINE_LIST", isConstant: true, value: 5 },
            { type: "uint8", name: "CUBE_LIST", isConstant: true, value: 6 },
            { type: "uint8", name: "SPHERE_LIST", isConstant: true, value: 7 },
            { type: "uint8", name: "POINTS", isConstant: true, value: 8 },
            { type: "uint8", name: "TEXT_VIEW_FACING", isConstant: true, value: 9 },
            { type: "uint8", name: "MESH_RESOURCE", isConstant: true, value: 10 },
            { type: "uint8", name: "TRIANGLE_LIST", isConstant: true, value: 11 },
            { type: "uint8", name: "ADD", isConstant: true, value: 0 },
            { type: "uint8", name: "MODIFY", isConstant: true, value: 0 },
            { type: "uint8", name: "DELETE", isConstant: true, value: 2 },
            { type: "std_msgs/Header", name: "header", isArray: false, isComplex: true },
            { type: "string", name: "ns", isArray: false, isComplex: false },
            { type: "int32", name: "type", isArray: false, isComplex: false },
            { type: "int32", name: "action", isArray: false, isComplex: false },
            { type: "geometry_msgs/Pose", name: "pose", isArray: false, isComplex: true },
            { type: "geometry_msgs/Vector3", name: "scale", isArray: false, isComplex: true },
            { type: "std_msgs/ColorRGBA", name: "color", isArray: false, isComplex: true },
            { type: "duration", name: "lifetime", isArray: false, isComplex: false },
            { type: "bool", name: "frame_locked", isArray: false, isComplex: false },
            { type: "geometry_msgs/Point", name: "points", isArray: true, isComplex: true },
            { type: "std_msgs/ColorRGBA", name: "colors", isArray: true, isComplex: true },
            { type: "string", name: "text", isArray: false, isComplex: false },
            { type: "string", name: "mesh_resource", isArray: false, isComplex: false },
            { type: "bool", name: "mesh_use_embedded_materials", isArray: false, isComplex: false },
            { type: "string", name: "id", isArray: false, isComplex: false },
            { type: "json", name: "metadata", isArray: false, isComplex: false },
          ],
        },
        {
          name: "std_msgs/ColorRGBA",
          definitions: [
            { type: "float32", name: "r", isArray: false, isComplex: false },
            { type: "float32", name: "g", isArray: false, isComplex: false },
            { type: "float32", name: "b", isArray: false, isComplex: false },
            { type: "float32", name: "a", isArray: false, isComplex: false },
          ],
        },
        {
          name: "geometry_msgs/Vector3",
          definitions: [
            { type: "float64", name: "x", isArray: false, isComplex: false },
            { type: "float64", name: "y", isArray: false, isComplex: false },
            { type: "float64", name: "z", isArray: false, isComplex: false },
          ],
        },
        {
          name: "/tableflow_metadata",
          definitions: [{ isArray: true, isComplex: false, name: "timestamps", type: "string" }],
        },
        {
          definitions: [
            { type: "std_msgs/Header", name: "header", isArray: false, isComplex: true },
            { isArray: true, isComplex: true, name: "markers", type: "visualization_msgs/WebvizMarker" },
            { isArray: true, isComplex: true, name: "futureMarkers", type: "visualization_msgs/WebvizMarker" },
          ],
        },
      ];
      const writer = new MessageWriter(defs);
      writer.writeMessage(msg);
    });
  });
});
