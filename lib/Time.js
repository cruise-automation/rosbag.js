// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// represents time stored in nanosecond precision
// sec is the whole seconds of the time since unix 1970
// nsec is the number of nanoseconds past the sec value
export default class Time {
  static fromDate(date) {
    const sec = Math.floor(date.getTime() / 1000);
    const nsec = date.getMilliseconds() * 1e6;
    return new Time(sec, nsec);
  }

  // compare two times, returning a negative value if the right is greater
  // or a positive value if the left is greater or 0 if the times are equal
  // useful to supply to Array.prototype.sort
  static compare(left, right) {
    const secDiff = left.sec - right.sec;
    return secDiff || left.nsec - right.nsec;
  }

  // returns true if the left time is less than the right time, otherwise false
  static isLessThan(left, right) {
    return this.compare(left, right) < 0;
  }

  // returns true if the left time is greater than the right time, otherwise false
  static isGreaterThan(left, right) {
    return this.compare(left, right) > 0;
  }

  // returns true if both times have the same number of seconds and nanoseconds
  static areSame(left, right) {
    return left.sec === right.sec && left.nsec === right.nsec;
  }

  // computes the sum of two times or durations and returns a new time
  static add(left, right) {
    const sec = left.sec + right.sec;
    const nsec = left.nsec + right.nsec;
    if (nsec < 1e9) {
      return new Time(sec, nsec);
    }
    const rollover = Math.floor(nsec / 1e9);
    const remainder = nsec % 1e9;
    return new Time(sec + rollover, remainder);
  }

  constructor(sec, nsec) {
    this.sec = sec;
    this.nsec = nsec;
  }

  toDate() {
    return new Date(this.sec * 1e3 + this.nsec / 1e6);
  }
}
