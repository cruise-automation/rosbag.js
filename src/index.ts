// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import BagReader from "./BagReader";
import { MessageReader } from "./MessageReader";
import { MessageWriter } from "./MessageWriter";
import * as TimeUtil from "./TimeUtil";
import Bag from "./bag";
import { extractFields, extractTime } from "./fields";
import { parseMessageDefinition, rosPrimitiveTypes } from "./parseMessageDefinition";

const { open } = Bag;

// These exports must match node/index.ts and web/index.ts
export * from "./types";
export {
  TimeUtil,
  Bag,
  BagReader,
  MessageReader,
  MessageWriter,
  open,
  parseMessageDefinition,
  rosPrimitiveTypes,
  extractFields,
  extractTime,
};
export default Bag;
