// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import type { Time } from "./types";

export function fromDate(date: Date) {
  const sec = Math.floor(date.getTime() / 1000);
  const nsec = date.getMilliseconds() * 1e6;
  return { sec, nsec };
}

export function toDate(time: Time) {
  return new Date(time.sec * 1e3 + time.nsec / 1e6);
}

// compare two times, returning a negative value if the right is greater
// or a positive value if the left is greater or 0 if the times are equal
// useful to supply to Array.prototype.sort
export function compare(left: Time, right: Time) {
  const secDiff = left.sec - right.sec;
  return secDiff || left.nsec - right.nsec;
}

// returns true if the left time is less than the right time, otherwise false
export function isLessThan(left: Time, right: Time) {
  return this.compare(left, right) < 0;
}

// returns true if the left time is greater than the right time, otherwise false
export function isGreaterThan(left: Time, right: Time) {
  return this.compare(left, right) > 0;
}

// returns true if both times have the same number of seconds and nanoseconds
export function areSame(left: Time, right: Time) {
  return left.sec === right.sec && left.nsec === right.nsec;
}

function toString(time: Time) {
  return `{${time.sec}, ${time.nsec}}`;
}

// computes the sum of two times or durations and returns a new time
// throws an exception if the resulting time is negative
export function add(left: Time, right: Time) {
  const durationNanos = left.nsec + right.nsec;
  const secsFromNanos = Math.floor(durationNanos / 1e9);
  const newSecs = left.sec + right.sec + secsFromNanos;
  const remainingDurationNanos = durationNanos % 1e9;
  // use Math.abs here to prevent -0 when there is exactly 1 second of negative nanoseconds passed in
  const newNanos = Math.abs(
    Math.sign(remainingDurationNanos) === -1 ? 1e9 + remainingDurationNanos : remainingDurationNanos
  );
  const result = { sec: newSecs, nsec: newNanos };
  if (result.sec < 0 || result.nsec < 0) {
    throw new Error(
      `Invalid time: ${toString(result)} produced from TimeUtil.add(${toString(left)}, ${toString(right)}})`
    );
  }
  return result;
}
