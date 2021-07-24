// Copyright 2018-2020 Cruise LLC
// Copyright 2021 Foxglove Technologies Inc
//
// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

/* eslint-disable filenames/match-exported */

import { Buffer } from "buffer";

import Bag from "../Bag";
import BagReader from "../BagReader";
import { Callback } from "../types";

// browser reader for Blob|File objects
export class Reader {
  _blob: Blob;
  _size: number;

  constructor(blob: Blob) {
    this._blob = blob;
    this._size = blob.size;
  }

  // read length (bytes) starting from offset (bytes)
  // callback(err, buffer)
  read(offset: number, length: number, cb: Callback<Buffer>): void {
    const reader = new FileReader();
    reader.onload = function () {
      reader.onload = null;
      reader.onerror = null;
      cb(null, Buffer.from(reader.result as ArrayBuffer));
    };
    reader.onerror = function () {
      reader.onload = null;
      reader.onerror = null;
      cb(reader.error ?? new Error("Unknown FileReader error"));
    };
    reader.readAsArrayBuffer(this._blob.slice(offset, offset + length));
  }

  // return the size of the file
  size(): number {
    return this._size;
  }
}

const open = async (file: File | string): Promise<Bag> => {
  if (!(file instanceof Blob)) {
    throw new Error(
      "Expected file to be a File or Blob. Make sure you are correctly importing the node or web version of Bag."
    );
  }
  const bag = new Bag(new BagReader(new Reader(file)));
  await bag.open();
  return bag;
};
Bag.open = open;

export type { Filelike } from "../types";
export { BagReader, open };
export default Bag;
