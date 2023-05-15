// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import type { RosMsgField, RosMsgDefinition } from "./types";

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
  "json",
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
function newArrayDefinition(type: string, name: string, arrayLength?: number): RosMsgField {
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

const tokenizeLine = (line: string) =>
  line
    .replace(/#.*/gi, "")
    .split(" ")
    .filter((word) => word);

const buildNamedType = (
  lines: {
    isJson: boolean;
    line: string;
  }[],
  typeName: string
): RosMsgDefinition => {
  const definitions: RosMsgField[] = [];
  lines.forEach(({ isJson, line }) => {
    // remove comments and extra whitespace from each line
    const splits = tokenizeLine(line);

    if (!splits[1]) {
      return;
    }

    // consume comments
    const type = splits[0].trim();
    const name = splits[1].trim();

    if (name.indexOf("=") > -1 || splits.indexOf("=") > -1) {
      // constant type parsing
      const matches = line.match(/(\S+)\s*=\s*(.*)\s*/);

      if (!matches) {
        throw new Error(`Malformed line: ${line}`);
      }

      let value: string | number | boolean = matches[2];

      if (type !== "string") {
        // handle special case of python bool values
        value = value.replace(/True/gi, "true");
        value = value.replace(/False/gi, "false");

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

      if ((type.includes("int") && +value > Number.MAX_SAFE_INTEGER) || +value < Number.MIN_SAFE_INTEGER) {
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
      definitions.push(newDefinition(isJson ? "json" : type, name));
    }
  });
  return {
    name: typeName,
    definitions,
  };
};

const buildType = (
  lines: {
    isJson: boolean;
    line: string;
  }[]
): RosMsgDefinition => {
  if (lines.length === 0) {
    throw new Error("Empty message definition.");
  }

  if (!lines[0].line.startsWith("MSG: ")) {
    throw new Error(`Malformed message definition name: ${lines[0].line}`);
  }

  const typeName = tokenizeLine(lines[0].line)[1].trim();
  return buildNamedType(lines.slice(1), typeName);
};

const findTypeByName = (types: RosMsgDefinition[], name: string, rosPackage: string): RosMsgDefinition => {
  // eslint-disable-next-line no-nested-ternary
  const fullName = name.includes("/") ? name : name === "Header" ? "std_msgs/Header" : `${rosPackage}/${name}`;
  const matches = types.filter((type) => type.name === fullName);

  if (matches.length !== 1) {
    throw new Error(
      `Expected 1 top level type definition for '${name}' but found ${matches.length}, ${JSON.stringify({
        fullName,
        k: types.map((type) => type.name),
      })}`
    );
  }

  return matches[0];
};

/**
 * Given a raw message definition string, parse it into an object representation.
 * Type names in all positions are always fully-qualified.
 *
 * Example return value:
 * [{
 *   name: "foo_msgs/Bar",
 *   definitions: [
 *     {
 *       arrayLength: undefined,
 *       isArray: false,
 *       isComplex: false,
 *       name: "name",
 *       type: "string",
 *     }, ...
 *   ],
 * }, ... ]
 *
 * See unit tests for more examples.
 */
export function parseMessageDefinition(messageDefinition: string, typeName: string) {
  // read all the lines and remove empties
  const allLines = messageDefinition
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line);
  let definitionLines: {
    isJson: boolean;
    line: string;
  }[] = [];
  const types: RosMsgDefinition[] = [];
  let nextDefinitionIsJson = false;
  // group lines into individual definitions
  allLines.forEach((line) => {
    // ignore comment lines unless they start with #pragma rosbag_parse_json
    if (line.startsWith("#")) {
      if (line.startsWith("#pragma rosbag_parse_json")) {
        nextDefinitionIsJson = true;
      }

      return;
    }

    // definitions are split by equal signs
    if (line.startsWith("==")) {
      nextDefinitionIsJson = false;
      const definition = types.length === 0 ? buildNamedType(definitionLines, typeName) : buildType(definitionLines);
      types.push(definition);
      definitionLines = [];
    } else {
      definitionLines.push({
        isJson: nextDefinitionIsJson,
        line,
      });
      nextDefinitionIsJson = false;
    }
  });
  const typeDefinition = types.length === 0 ? buildNamedType(definitionLines, typeName) : buildType(definitionLines);
  types.push(typeDefinition);

  // Fix up complex type names
  types.forEach(({ name, definitions }) => {
    const typePackage = name.split("/")[0];
    definitions.forEach((definition) => {
      if (definition.isComplex) {
        const foundName = findTypeByName(types, definition.type, typePackage).name;

        if (foundName === undefined) {
          throw new Error(`Missing type definition for ${definition.type}`);
        }

        definition.type = foundName;
      }
    });
  });

  return types;
}
