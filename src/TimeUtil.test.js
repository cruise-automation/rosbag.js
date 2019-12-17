// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import * as TimeUtil from "./TimeUtil";

describe("TimeUtil", () => {
  const date = new Date(1511798097280);

  it("can be created from a date", () => {
    const time = TimeUtil.fromDate(date);
    expect(time.sec).toBe(Math.floor(1511798097280 / 1000));
    expect(time.nsec).toBe(280000000);
  });

  it("can convert to a date", () => {
    const time = { sec: 1511798097, nsec: 280000000 };
    expect(TimeUtil.toDate(time)).toEqual(date);
  });

  it("can sort by compare", () => {
    const times = [{ sec: 1, nsec: 1 }, { sec: 0, nsec: 0 }, { sec: 1, nsec: 0 }, { sec: 0, nsec: 1 }];
    times.sort(TimeUtil.compare);
    expect(times).toEqual([{ sec: 0, nsec: 0 }, { sec: 0, nsec: 1 }, { sec: 1, nsec: 0 }, { sec: 1, nsec: 1 }]);
  });

  it("has lessThan functionality", () => {
    const min = { sec: 0, nsec: 0 };
    const oneNano = { sec: 0, nsec: 1 };
    const max = { sec: 1, nsec: 1 };
    expect(TimeUtil.isLessThan(min, min)).toBe(false);
    expect(TimeUtil.isLessThan(max, min)).toBe(false);
    expect(TimeUtil.isLessThan(oneNano, min)).toBe(false);
    expect(TimeUtil.isLessThan(min, oneNano)).toBe(true);
    expect(TimeUtil.isLessThan(min, max)).toBe(true);
  });

  it("has greaterThan functionality", () => {
    const min = { sec: 0, nsec: 0 };
    const oneNano = { sec: 0, nsec: 1 };
    const max = { sec: 1, nsec: 1 };
    expect(TimeUtil.isGreaterThan(min, min)).toBe(false);
    expect(TimeUtil.isGreaterThan(max, min)).toBe(true);
    expect(TimeUtil.isGreaterThan(oneNano, min)).toBe(true);
    expect(TimeUtil.isGreaterThan(min, oneNano)).toBe(false);
    expect(TimeUtil.isGreaterThan(min, max)).toBe(false);
  });

  it("tests for sameness", () => {
    const min = { sec: 0, nsec: 0 };
    const min2 = { sec: 0, nsec: 0 };
    const oneNano = { sec: 0, nsec: 1 };
    expect(min === min2).toBe(false);
    expect(TimeUtil.areSame(min, min2)).toBe(true);
    expect(TimeUtil.areSame(min, oneNano)).toBe(false);
  });

  const testAddition = (left, right, expected) => {
    expect(TimeUtil.add(left, right)).toEqual(expected);
    expect(TimeUtil.add(right, left)).toEqual(expected);
  };

  it("can add two times together", () => {
    testAddition({ sec: 0, nsec: 0 }, { sec: 0, nsec: 0 }, { sec: 0, nsec: 0 });
    testAddition({ sec: 1, nsec: 100 }, { sec: 2, nsec: 200 }, { sec: 3, nsec: 300 });
    testAddition({ sec: 0, nsec: 1e9 - 1 }, { sec: 0, nsec: 1 }, { sec: 1, nsec: 0 });
    testAddition({ sec: 0, nsec: 1e9 - 1 }, { sec: 0, nsec: 101 }, { sec: 1, nsec: 100 });
    testAddition({ sec: 3, nsec: 0 }, { sec: 0, nsec: 2 * -1e9 }, { sec: 1, nsec: 0 });
    testAddition({ sec: 1, nsec: 1 }, { sec: 0, nsec: -2 }, { sec: 0, nsec: 1e9 - 1 });
    testAddition({ sec: 1, nsec: 1 }, { sec: 0, nsec: -2 }, { sec: 0, nsec: 1e9 - 1 });
    testAddition({ sec: 3, nsec: 1 }, { sec: -2, nsec: -2 }, { sec: 0, nsec: 1e9 - 1 });
    testAddition({ sec: 1, nsec: 0 }, { sec: 0, nsec: -1e9 }, { sec: 0, nsec: 0 });
    testAddition({ sec: 3, nsec: 1 }, { sec: 1, nsec: -2 }, { sec: 3, nsec: 1e9 - 1 });
    testAddition({ sec: 3, nsec: 0 }, { sec: 0, nsec: -(2 * 1e9) + 1 }, { sec: 1, nsec: 1 });
    testAddition({ sec: 10, nsec: 0 }, { sec: 10, nsec: 10 * 1e9 }, { sec: 30, nsec: 0 });
    testAddition({ sec: 10, nsec: 0 }, { sec: 10, nsec: -10 * 1e9 }, { sec: 10, nsec: 0 });
    testAddition({ sec: 0, nsec: 0 }, { sec: 10, nsec: -10 * 1e9 }, { sec: 0, nsec: 0 });
  });

  it("throws when addition results in negative time", () => {
    expect(() => TimeUtil.add({ sec: 0, nsec: 0 }, { sec: -1, nsec: 0 })).toThrow();
    expect(() => TimeUtil.add({ sec: 0, nsec: 0 }, { sec: 0, nsec: -1 })).toThrow();
  });
});
