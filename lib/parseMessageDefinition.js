// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// Set of built-in ros types. See http://wiki.ros.org/msg#Field_Types
const builtins = new Set([
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

function normalizeType(type) {
  // Normalize deprecated aliases.
  let normalizedType = type;
  if (type === "char") normalizedType = "uint8";
  if (type === "byte") normalizedType = "int8";
  return normalizedType;
}

// represents a single line in a message definition type
// e.g. 'string name' 'CustomType[] foo' 'string[3] names'
function newDefinition(type, name, isArray = false, arrayLength = undefined) {
  const normalizedType = normalizeType(type);
  return {
    type: normalizedType,
    name,
    isArray,
    arrayLength,
    isComplex: !builtins.has(normalizedType),
  };
}

const buildType = (lines) => {
  const definitions = [];
  let complexTypeName;
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
      let value = matches[2];
      if (type !== "string") {
        try {
          value = JSON.parse(value.replace(/\s*#.*/g, ""));
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(`Error in this constant definition: ${line}`);
          throw error;
        }
        if (type === "bool") value = Boolean(value);
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
      const arrayLength = parseInt(typeSplits[1].replace("]", ""), 10) || undefined;
      definitions.push(newDefinition(baseType, name, true, arrayLength));
    } else {
      definitions.push(newDefinition(type, name));
    }
  });
  return { name: complexTypeName, definitions };
};

const findTypeByName = (types, name = "") => {
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

export { builtins };

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
export function parseMessageDefinition(messageDefinition = "") {
  // read all the lines and remove empties
  const allLines = messageDefinition
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line);

  let definitionLines = [];
  const types = [];
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
        definition.type = findTypeByName(types, definition.type).name;
      }
    });
  });

  return types;
}
