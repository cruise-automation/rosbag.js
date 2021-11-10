// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import { parseMessageDefinition } from "./parseMessageDefinition";

describe("parseMessageDefinition", () => {
  it("parses a single field from a single message", () => {
    const types = parseMessageDefinition("string name", "foo_msgs/Bar");
    expect(types).toEqual([
      {
        definitions: [
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: false,
            name: "name",
            type: "string",
          },
        ],
        name: "foo_msgs/Bar",
      },
    ]);
  });

  it("resolves unqualified names", () => {
    const messageDefinition = `
      Point[] points
      ============
      MSG: geometry_msgs/Point
      float64 x
    `;
    const types = parseMessageDefinition(messageDefinition, "geometry_msgs/Polygon");
    expect(types).toEqual([
      {
        definitions: [
          {
            arrayLength: undefined,
            isArray: true,
            isComplex: true,
            name: "points",
            type: "geometry_msgs/Point",
          },
        ],
        name: "geometry_msgs/Polygon",
      },
      {
        definitions: [
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: false,
            name: "x",
            type: "float64",
          },
        ],
        name: "geometry_msgs/Point",
      },
    ]);
  });

  it("resolves seemingly-ambiguous unqualified names", () => {
    const messageDefinition = `
      Header header # doesn't say std_msgs, but we special-case it.
      Ambiguous m1 # refers to this_msgs/Ambiguous
      other_msgs/Other
      ============
      MSG: other_msgs/Other
      Ambiguous # refers to other_msgs/Ambiguous
      ============
      MSG: this_msgs/Ambiguous
      ============
      MSG: other_msgs/Ambiguous
      ============
      MSG: std_msgs/Header
    `;
    const types = parseMessageDefinition(messageDefinition, "this_msgs/Message");
    expect(types).toEqual([
      {
        definitions: [
          { isArray: false, isComplex: true, name: "header", type: "std_msgs/Header" },
          { isArray: false, isComplex: true, name: "m1", type: "this_msgs/Ambiguous" },
        ],
        name: "this_msgs/Message",
      },
      { definitions: [], name: "other_msgs/Other" },
      { definitions: [], name: "this_msgs/Ambiguous" },
      { definitions: [], name: "other_msgs/Ambiguous" },
      { definitions: [], name: "std_msgs/Header" },
    ]);
  });

  it("normalizes aliases", () => {
    const types = parseMessageDefinition("char x\nbyte y", "foo_msgs/Bar");
    expect(types).toEqual([
      {
        definitions: [
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: false,
            name: "x",
            type: "uint8",
          },
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: false,
            name: "y",
            type: "int8",
          },
        ],
        name: "foo_msgs/Bar",
      },
    ]);
  });

  it("ignores comment lines", () => {
    const messageDefinition = `
    # your first name goes here
    string firstName

    # last name here
    ### foo bar baz?
    string lastName
    `;
    const types = parseMessageDefinition(messageDefinition, "foo_msgs/Bar");
    expect(types).toEqual([
      {
        definitions: [
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: false,
            name: "firstName",
            type: "string",
          },
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: false,
            name: "lastName",
            type: "string",
          },
        ],
        name: "foo_msgs/Bar",
      },
    ]);
  });

  it("parses variable length string array", () => {
    const types = parseMessageDefinition("string[] names", "foo_msgs/Bar");
    expect(types).toEqual([
      {
        definitions: [
          {
            arrayLength: undefined,
            isArray: true,
            isComplex: false,
            name: "names",
            type: "string",
          },
        ],
        name: "foo_msgs/Bar",
      },
    ]);
  });

  it("parses fixed length string array", () => {
    const types = parseMessageDefinition("string[3] names", "foo_msgs/Bar");
    expect(types).toEqual([
      {
        definitions: [
          {
            arrayLength: 3,
            isArray: true,
            isComplex: false,
            name: "names",
            type: "string",
          },
        ],
        name: "foo_msgs/Bar",
      },
    ]);
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
    const types = parseMessageDefinition(messageDefinition, "custom_type/CustomMessage");
    expect(types).toEqual([
      {
        definitions: [
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: false,
            name: "username",
            type: "string",
          },
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: true,
            name: "account",
            type: "custom_type/Account",
          },
        ],
        name: "custom_type/CustomMessage",
      },
      {
        definitions: [
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: false,
            name: "name",
            type: "string",
          },
          {
            arrayLength: undefined,
            isArray: false,
            isComplex: false,
            name: "id",
            type: "uint16",
          },
        ],
        name: "custom_type/Account",
      },
    ]);
  });

  it("returns constants", () => {
    const messageDefinition = `
      uint32 foo = 55
      int32 bar=-11 # Comment # another comment
      float32 baz= \t -32.25
      bool someBoolean = 0
      string fooStr = Foo    ${""}
      string EXAMPLE="#comments" are ignored, and leading and trailing whitespace removed
    `;
    const types = parseMessageDefinition(messageDefinition, "foo_msgs/Bar");
    expect(types).toEqual([
      {
        definitions: [
          {
            name: "foo",
            type: "uint32",
            isConstant: true,
            value: 55,
          },
          {
            name: "bar",
            type: "int32",
            isConstant: true,
            value: -11,
          },
          {
            name: "baz",
            type: "float32",
            isConstant: true,
            value: -32.25,
          },
          {
            name: "someBoolean",
            type: "bool",
            isConstant: true,
            value: false,
          },
          {
            name: "fooStr",
            type: "string",
            isConstant: true,
            value: "Foo",
          },
          {
            name: "EXAMPLE",
            type: "string",
            isConstant: true,
            value: '"#comments" are ignored, and leading and trailing whitespace removed',
          },
        ],
        name: "foo_msgs/Bar",
      },
    ]);
  });

  it("works with python boolean values", () => {
    const messageDefinition = `
      bool Alive=True
      bool Dead=False
    `;
    const types = parseMessageDefinition(messageDefinition, "foo_msgs/Bar");
    expect(types).toEqual([
      {
        definitions: [
          {
            name: "Alive",
            type: "bool",
            isConstant: true,
            value: true,
          },
          {
            name: "Dead",
            type: "bool",
            isConstant: true,
            value: false,
          },
        ],
        name: "foo_msgs/Bar",
      },
    ]);
  });
});
