// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

// Set of built-in ros types. See http://wiki.ros.org/msg#Field_Types
export const rosPrimitiveTypes: Set<string> = new Set([
  "string",
  "bool",
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "float32",
  "float64",
  "int64",
  "uint64",
  "time",
  "duration",
]);

function normalizeType(type: string) {
  // Normalize deprecated aliases.
  let normalizedType = type;
  if (type === "char") {
    normalizedType = "uint8";
  }
  if (type === "byte") {
    normalizedType = "int8";
  }
  return normalizedType;
}

// represents a single line in a message definition type
// e.g. 'string name' 'CustomType[] foo' 'string[3] names'
function newArrayDefinition(type: string, name: string, arrayLength: ?number): RosMsgField {
  const normalizedType = normalizeType(type);
  return {
    type: normalizedType,
    name,
    isArray: true,
    arrayLength: arrayLength === null ? undefined : arrayLength,
    isComplex: !rosPrimitiveTypes.has(normalizedType),
  };
}
function newDefinition(type: string, name: string): RosMsgField {
  const normalizedType = normalizeType(type);
  return {
    type: normalizedType,
    name,
    isArray: false,
    isComplex: !rosPrimitiveTypes.has(normalizedType),
  };
}

export type RosMsgField =
  | {|
      type: string,
      name: string,
      isConstant?: boolean,
      isComplex?: boolean,
      value?: mixed,
      isArray?: false,
      arrayLength?: void,
    |}
  | {|
      type: string,
      name: string,
      isConstant?: boolean,
      isComplex?: boolean,
      value?: mixed,
      isArray: true,
      arrayLength: ?number,
    |};

export type RosMsgDefinition = {|
  name?: string,
  definitions: RosMsgField[],
|};
export type NamedRosMsgDefinition = {|
  name: string,
  definitions: RosMsgField[],
|};

const buildType = (lines: string[]): RosMsgDefinition => {
  const definitions: RosMsgField[] = [];
  let complexTypeName: ?string;
  lines.forEach((line) => {
    // remove comments and extra whitespace from each line
    const splits = line
      .replace(/#.*/gi, "")
      .split(" ")
      .filter((word) => word);
    if (!splits[1]) {
      return;
    }
    // consume comments
    const type = splits[0].trim();
    const name = splits[1].trim();
    if (type === "MSG:") {
      complexTypeName = name;
    } else if (name.indexOf("=") > -1 || splits.indexOf("=") > -1) {
      // constant type parsing
      const matches = line.match(/(\S+)\s*=\s*(.*)\s*/);
      if (!matches) {
        throw new Error("Malformed line: " + line);
      }
      let value: any = matches[2];
      if (type !== "string") {
        try {
          value = JSON.parse(value.replace(/\s*#.*/g, ""));
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(`Error in this constant definition: ${line}`);
          throw error;
        }
        if (type === "bool") {
          value = Boolean(value);
        }
      }
      if ((type.includes("int") && value > Number.MAX_SAFE_INTEGER) || value < Number.MIN_SAFE_INTEGER) {
        // eslint-disable-next-line no-console
        console.warn(`Found integer constant outside safe integer range: ${line}`);
      }
      definitions.push({
        type: normalizeType(type),
        name: matches[1],
        isConstant: true,
        value,
      });
    } else if (type.indexOf("]") === type.length - 1) {
      // array type parsing
      const typeSplits = type.split("[");
      const baseType = typeSplits[0];
      const len = typeSplits[1].replace("]", "");
      definitions.push(newArrayDefinition(baseType, name, len ? parseInt(len, 10) : undefined));
    } else {
      definitions.push(newDefinition(type, name));
    }
  });
  return { name: complexTypeName, definitions };
};

const findTypeByName = (types: RosMsgDefinition[], name: string): RosMsgDefinition => {
  const matches = types.filter((type) => {
    const typeName = type.name || "";
    // if the search is empty, return unnamed types
    if (!name) {
      return !typeName;
    }
    // return if the search is in the type name
    // or matches exactly if a fully-qualified name match is passed to us
    const nameEnd = name.indexOf("/") > -1 ? name : `/${name}`;
    return typeName.endsWith(nameEnd);
  });
  if (matches.length !== 1) {
    throw new Error(`Expected 1 top level type definition for '${name}' but found ${matches.length}`);
  }
  return matches[0];
};

// Given a raw message definition string, parse it into an object representation.
// Example return value:
// [{
//   name: undefined,
//   definitions: [
//     {
//       arrayLength: undefined,
//       isArray: false,
//       isComplex: false,
//       name: "name",
//       type: "string",
//     }, ...
//   ],
// }, ... ]
//
// See unit tests for more examples.
export function parseMessageDefinition(messageDefinition: string) {
  // read all the lines and remove empties
  const allLines = messageDefinition
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line);

  let definitionLines: string[] = [];
  const types: RosMsgDefinition[] = [];
  // group lines into individual definitions
  allLines.forEach((line) => {
    // skip comment lines
    if (line.indexOf("#") === 0) {
      return;
    }
    // definitions are split by equal signs
    if (line.indexOf("==") === 0) {
      types.push(buildType(definitionLines));
      definitionLines = [];
    } else {
      definitionLines.push(line);
    }
  });
  types.push(buildType(definitionLines));

  // Fix up complex type names
  types.forEach(({ definitions }) => {
    definitions.forEach((definition) => {
      if (definition.isComplex) {
        const foundName = findTypeByName(types, definition.type).name;
        if (foundName === undefined) {
          throw new Error(`Missing type definition for ${definition.type}`);
        }
        definition.type = foundName;
      }
    });
  });

  return types;
}
