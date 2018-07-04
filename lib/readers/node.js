// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// reader using nodejs fs api
import fs from "fs";
import { Buffer } from "buffer";

class Reader {
  constructor(filename) {
    this._filename = filename;
    this._fd = undefined;
    this._size = 0;
    this._buffer = Buffer.allocUnsafe(0);
  }

  // open a file for reading
  _open(cb) {
    fs.stat(this._filename, (err, stat) => {
      if (err) {
        return cb(err);
      }

      return fs.open(this._filename, "r", (err, fd) => {
        if (err) {
          return cb(err);
        }

        this._fd = fd;
        this._size = stat.size;
        return cb(null);
      });
    });
  }

  close(cb) {
    fs.close(this._fd, cb);
  }

  // read length (bytes) starting from offset (bytes)
  // callback(err, buffer)
  read(offset, length, cb) {
    if (!this._fd) {
      return this._open((err) => {
        return err ? cb(err) : this.read(offset, length, cb);
      });
    }
    if (length > this._buffer.byteLength) {
      this._buffer = Buffer.alloc(length);
    }
    return fs.read(this._fd, this._buffer, 0, length, offset, (err, bytes, buff) => {
      return cb(err, buff);
    });
  }

  // return the size of the file
  size() {
    return this._size;
  }
}

export default Reader;
